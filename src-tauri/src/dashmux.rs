//! DASH m4s 音视频流合并（替代 ffmpeg `-c copy -movflags +faststart`）
//!
//! 设计：
//! - moov 元信息（SPS/PPS、esds 采样率/声道、timescale）复用 `mp4` crate 解析（仅读 init 段，可靠）
//! - 分片采样表（tfhd/tfdt/trun）自研解析：mp4 crate 0.14 的分片 read_sample 存在偏移计算缺陷
//!   （base_data_offset 缺失时回退 0、忽略 tfdt），不可用
//! - 写出用 `mp4` crate writer（avcC/esds/stts/ctts/stss 生成可靠），轨道 id 按添加顺序 1=视频 2=音频
//! - 写完做 faststart 重排：ftyp+mdat+moov → ftyp+moov+mdat，stco/co64 偏移整体平移
//!
//! 仅支持无转码 copy：视频 AVC（avc1）+ 音频 AAC（mp4a）。
//! HEVC（hev1）/AV1（av01）返回 Err，由调用方回退（ffmpeg on PATH → durl 低清合并流）。

use mp4::{
    AacConfig, AvcConfig, AudioObjectType, FourCC, MediaConfig, Mp4Config, Mp4Reader, Mp4Sample,
    Mp4Writer, TrackConfig, TrackType,
};
use std::fs::File;
use std::io::{BufReader, BufWriter, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

const OUT_VIDEO_TRACK_ID: u32 = 1;
const OUT_AUDIO_TRACK_ID: u32 = 2;
const COPY_BUF_SIZE: usize = 1024 * 1024;

pub fn remux_dash_to_mp4(
    video_path: &Path,
    audio_path: &Path,
    out_path: &Path,
) -> Result<(), String> {
    let v = moov_video_info(video_path)?;
    let a = moov_audio_info(audio_path)?;
    let v_samples = track_samples(video_path, v.track_id)?;
    let a_samples = track_samples(audio_path, a.track_id)?;
    if v_samples.is_empty() {
        return Err("视频流没有可读取的采样".to_string());
    }
    if a_samples.is_empty() {
        return Err("音频流没有可读取的采样".to_string());
    }
    let out = File::create(out_path).map_err(|e| format!("创建输出文件失败: {}", e))?;
    let config = Mp4Config {
        major_brand: str::parse("isom").unwrap(),
        minor_version: 512,
        compatible_brands: vec![
            str::parse("isom").unwrap(),
            str::parse("iso2").unwrap(),
            str::parse("avc1").unwrap(),
            str::parse("mp41").unwrap(),
        ],
        timescale: 1000,
    };
    let mut writer = Mp4Writer::write_start(BufWriter::new(out), &config)
        .map_err(|e| format!("mp4 初始化失败: {}", e))?;

    writer
        .add_track(&TrackConfig {
            track_type: TrackType::Video,
            timescale: v.timescale,
            language: v.language.clone(),
            media_conf: MediaConfig::AvcConfig(AvcConfig {
                width: v.width,
                height: v.height,
                seq_param_set: v.sps.clone(),
                pic_param_set: v.pps.clone(),
            }),
        })
        .map_err(|e| format!("添加视频轨失败: {}", e))?;

    writer
        .add_track(&TrackConfig {
            track_type: TrackType::Audio,
            timescale: a.timescale,
            language: a.language.clone(),
            media_conf: MediaConfig::AacConfig(AacConfig {
                bitrate: a.bitrate,
                profile: AudioObjectType::AacLowComplexity,
                freq_index: a.freq_index,
                chan_conf: a.chan_conf,
            }),
        })
        .map_err(|e| format!("添加音频轨失败: {}", e))?;

    let mut vf = File::open(video_path).map_err(|e| format!("打开视频流失败: {}", e))?;
    for (i, s) in v_samples.metas.iter().enumerate() {
        let bytes: Vec<u8> = match &v_samples.inline {
            Some(list) => list[i].to_vec(),
            None => read_at(&mut vf, s.offset, s.size as usize)?,
        };
        writer
            .write_sample(
                OUT_VIDEO_TRACK_ID,
                &Mp4Sample {
                    start_time: s.dts,
                    duration: s.duration,
                    rendering_offset: s.cts_offset,
                    is_sync: s.is_sync,
                    bytes: mp4::Bytes::from(bytes),
                },
            )
            .map_err(|e| format!("写入视频采样 #{} 失败: {}", i + 1, e))?;
    }

    let mut af = File::open(audio_path).map_err(|e| format!("打开音频流失败: {}", e))?;
    for (i, s) in a_samples.metas.iter().enumerate() {
        let bytes: Vec<u8> = match &a_samples.inline {
            Some(list) => list[i].to_vec(),
            None => read_at(&mut af, s.offset, s.size as usize)?,
        };
        writer
            .write_sample(
                OUT_AUDIO_TRACK_ID,
                &Mp4Sample {
                    start_time: s.dts,
                    duration: s.duration,
                    rendering_offset: s.cts_offset,
                    is_sync: s.is_sync,
                    bytes: mp4::Bytes::from(bytes),
                },
            )
            .map_err(|e| format!("写入音频采样 #{} 失败: {}", i + 1, e))?;
    }

    writer
        .write_end()
        .map_err(|e| format!("mp4 收尾失败: {}", e))?;
    drop(writer); // 显式释放 BufWriter，确保 moov 落盘后再做 faststart 重排

    reorder_faststart(out_path)
}

// ---------------------------------------------------------------------------
// moov 元信息（用 mp4 crate 解析，仅依赖 init 段）
// ---------------------------------------------------------------------------

fn open_reader(path: &Path) -> Result<Mp4Reader<BufReader<File>>, String> {
    let f = File::open(path).map_err(|e| format!("打开 {} 失败: {}", path.display(), e))?;
    let size = f
        .metadata()
        .map_err(|e| format!("读取 {} 元信息失败: {}", path.display(), e))?
        .len();
    Mp4Reader::read_header(BufReader::new(f), size).map_err(|e| format!("解析 m4s 失败: {}", e))
}

struct VideoTrackInfo {
    track_id: u32,
    timescale: u32,
    language: String,
    width: u16,
    height: u16,
    sps: Vec<u8>,
    pps: Vec<u8>,
}

struct AudioTrackInfo {
    track_id: u32,
    timescale: u32,
    language: String,
    bitrate: u32,
    freq_index: mp4::SampleFreqIndex,
    chan_conf: mp4::ChannelConfig,
}

fn moov_video_info(path: &Path) -> Result<VideoTrackInfo, String> {
    let reader = open_reader(path)?;
    let avc1: FourCC = str::parse("avc1").unwrap();
    let track = reader
        .tracks()
        .values()
        .find(|t| {
            matches!(t.track_type(), Ok(TrackType::Video))
                && t.box_type().map(|b| b == avc1).unwrap_or(false)
        })
        .ok_or_else(|| {
            let codecs: Vec<String> = reader
                .tracks()
                .values()
                .map(|t| {
                    t.box_type()
                        .map(|c| c.to_string())
                        .unwrap_or_else(|_| "未知".into())
                })
                .collect();
            format!("暂不支持的原生合并视频编码（{}）", codecs.join(", "))
        })?;
    let track_id = track.track_id();
    Ok(VideoTrackInfo {
        track_id,
        timescale: track.timescale(),
        language: track.language().to_string(),
        width: track.width(),
        height: track.height(),
        sps: track
            .sequence_parameter_set()
            .map_err(|e| format!("读取 SPS 失败: {}", e))?
            .to_vec(),
        pps: track
            .picture_parameter_set()
            .map_err(|e| format!("读取 PPS 失败: {}", e))?
            .to_vec(),
    })
}

fn moov_audio_info(path: &Path) -> Result<AudioTrackInfo, String> {
    let reader = open_reader(path)?;
    let mp4a: FourCC = str::parse("mp4a").unwrap();
    let track = reader
        .tracks()
        .values()
        .find(|t| {
            matches!(t.track_type(), Ok(TrackType::Audio))
                && t.box_type().map(|b| b == mp4a).unwrap_or(false)
        })
        .ok_or_else(|| "音频轨不是 AAC（mp4a）".to_string())?;
    let track_id = track.track_id();
    Ok(AudioTrackInfo {
        track_id,
        timescale: track.timescale(),
        language: track.language().to_string(),
        bitrate: track.bitrate(),
        freq_index: track
            .sample_freq_index()
            .map_err(|e| format!("读取音频采样率失败: {}", e))?,
        chan_conf: track
            .channel_config()
            .map_err(|e| format!("读取音频声道失败: {}", e))?,
    })
}
// ---------------------------------------------------------------------------
// 分片采样表解析（tfhd / tfdt / trun）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct SampleMeta {
    /// 采样数据偏移（相对 base，emit 时加上绝对基准）
    offset: u64,
    size: u32,
    /// 解码时间戳（源 timescale，绝对值，已含 tfdt 基准）
    dts: u64,
    duration: u32,
    /// 合成时间偏移（pts = dts + cts_offset）
    cts_offset: i32,
    is_sync: bool,
}

/// tfhd flags
const TFHD_BASE_DATA_OFFSET: u32 = 0x000001;
const TFHD_DEFAULT_SAMPLE_DURATION: u32 = 0x000008;
const TFHD_DEFAULT_SAMPLE_SIZE: u32 = 0x000010;
const TFHD_DEFAULT_SAMPLE_FLAGS: u32 = 0x000020;
const TFHD_DEFAULT_BASE_IS_MOOF: u32 = 0x020000;

/// trun flags
const TRUN_DATA_OFFSET: u32 = 0x000001;
const TRUN_FIRST_SAMPLE_FLAGS: u32 = 0x000004;
const TRUN_SAMPLE_DURATION: u32 = 0x000100;
const TRUN_SAMPLE_SIZE: u32 = 0x000200;
const TRUN_SAMPLE_FLAGS: u32 = 0x000400;
const TRUN_SAMPLE_CTS_OFFSET: u32 = 0x000800;

/// 采样 is_non_sync_sample 标志位
const SAMPLE_IS_NON_SYNC: u32 = 0x0001_0000;

#[derive(Debug, Clone, Copy)]
enum BaseKind {
    /// tfhd 显式给出绝对偏移
    Explicit(u64),
    /// default-base-is-moof：相对 moof box 起始
    MoofStart,
    /// 隐式：跟随 moof 之后的 mdat box 起始
    FollowMdat,
}

struct PendingTraf {
    track_id: u32,
    samples: Vec<SampleMeta>,
    base: BaseKind,
}

struct PendingMoof {
    moof_start: u64,
    trafs: Vec<PendingTraf>,
}

fn fullbox_flags(b: &[u8]) -> u32 {
    // version(1B) + flags(3B)，取低 24 位
    u32::from_be_bytes([b[0], b[1], b[2], b[3]]) & 0x00FF_FFFF
}

/// 采样收集结果：分片输入按 offset 从源文件读；非分片输入字节直接内联
struct TrackSamples {
    metas: Vec<SampleMeta>,
    /// 非分片回退路径的内联采样字节（与 metas 一一对应）
    inline: Option<Vec<mp4::Bytes>>,
}

impl TrackSamples {
    fn is_empty(&self) -> bool {
        self.metas.is_empty()
    }
}

/// 采样收集：优先分片解析（moof/trun），非分片输入回退 mp4 crate 常规读路径
fn track_samples(path: &Path, track_id: u32) -> Result<TrackSamples, String> {
    let metas = collect_track_samples(path, track_id)?;
    if !metas.is_empty() {
        return Ok(TrackSamples { metas, inline: None });
    }

    // 非分片 mp4（部分 m4s 是普通渐进式 mp4）：crate 的 stbl 读路径可靠
    let mut reader = open_reader(path)?;
    let count = reader
        .sample_count(track_id)
        .map_err(|e| format!("统计采样数失败: {}", e))?;
    let mut metas = Vec::with_capacity(count as usize);
    let mut inline = Vec::with_capacity(count as usize);
    for id in 1..=count {
        let s = reader
            .read_sample(track_id, id)
            .map_err(|e| format!("读取采样 #{} 失败: {}", id, e))?
            .ok_or_else(|| format!("采样 #{} 缺失", id))?;
        metas.push(SampleMeta {
            offset: 0,
            size: s.bytes.len() as u32,
            dts: s.start_time,
            duration: s.duration,
            cts_offset: s.rendering_offset,
            is_sync: s.is_sync,
        });
        inline.push(s.bytes);
    }
    Ok(TrackSamples {
        metas,
        inline: Some(inline),
    })
}

/// 遍历 fMP4 文件的所有 moof/mdat，收集指定 track 的采样元信息
fn collect_track_samples(path: &Path, track_id: u32) -> Result<Vec<SampleMeta>, String> {
    let mut f = File::open(path).map_err(|e| format!("打开 {} 失败: {}", path.display(), e))?;
    let file_len = f.metadata().map_err(|e| e.to_string())?.len();

    let mut pos: u64 = 0;
    let mut pending: Vec<PendingMoof> = Vec::new();
    let mut out: Vec<SampleMeta> = Vec::new();

    while pos < file_len {
        let (size32, box_type, mut total) = read_box_header_at(&mut f, pos)?;
        if size32 == 0 {
            // size 到文件尾（mdat 惯用法）
            total = file_len - pos;
        } else if total < 8 {
            return Err(format!("非法 box size {} @ {}", total, pos));
        }
        match &box_type {
            b"moof" => {
                let mut buf = vec![0u8; total as usize];
                f.seek(SeekFrom::Start(pos))
                    .and_then(|_| f.read_exact(&mut buf))
                    .map_err(|e| format!("读取 moof 失败: {}", e))?;
                pending.push(parse_moof(&buf, pos)?);
            }
            b"mdat" => {
                // 非分片文件（无 moof）的 mdat 在此处忽略，由 track_samples 回退路径处理
                let moofs = std::mem::take(&mut pending);
                for m in moofs {
                    for t in m.trafs {
                        if t.track_id != track_id {
                            continue;
                        }
                        let base = match t.base {
                            BaseKind::Explicit(o) => o,
                            BaseKind::MoofStart => m.moof_start,
                            BaseKind::FollowMdat => pos, // mdat box 起始（含 8 字节头）
                        };
                        for mut s in t.samples {
                            s.offset = base
                                .checked_add(s.offset)
                                .ok_or("采样偏移溢出")?;
                            out.push(s);
                        }
                    }
                }
            }
            _ => {}
        }
        pos += total;
    }

    Ok(out)
}

/// 解析一个 moof box（buf 从 box 头开始）
fn parse_moof(buf: &[u8], moof_start: u64) -> Result<PendingMoof, String> {
    let mut trafs: Vec<PendingTraf> = Vec::new();

    let mut pos: usize = 8; // 跳过 moof 自身头
    while pos + 8 <= buf.len() {
        let size32 = u32::from_be_bytes([buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]]);
        let box_type = [buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]];
        let header: usize = if size32 == 1 { 16 } else { 8 };
        let total: u64 = if size32 == 1 {
            if pos + 16 > buf.len() {
                break;
            }
            u64::from_be_bytes([
                buf[pos + 8],
                buf[pos + 9],
                buf[pos + 10],
                buf[pos + 11],
                buf[pos + 12],
                buf[pos + 13],
                buf[pos + 14],
                buf[pos + 15],
            ])
        } else {
            size32 as u64
        };
        if total < header as u64 || pos + total as usize > buf.len() {
            break;
        }
        let content_end = pos + total as usize;

        if &box_type == b"traf" {
            trafs.push(parse_traf(&buf[pos + header..content_end])?);
        }
        pos = content_end;
    }

    if trafs.is_empty() {
        return Err("moof 内没有 traf".to_string());
    }
    Ok(PendingMoof { moof_start, trafs })
}

/// 解析 traf（tfhd + tfdt + trun*）
fn parse_traf(buf: &[u8]) -> Result<PendingTraf, String> {
    let mut track_id: Option<u32> = None;
    let mut tfhd_base: Option<u64> = None;
    let mut default_base_is_moof = false;
    let mut def_duration: Option<u32> = None;
    let mut def_size: Option<u32> = None;
    let mut def_flags: Option<u32> = None;
    let mut dts: Option<u64> = None;
    let mut samples: Vec<SampleMeta> = Vec::new();

    let mut pos: usize = 0;
    while pos + 8 <= buf.len() {
        let size32 = u32::from_be_bytes([buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]]);
        let box_type = [buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]];
        let header: usize = if size32 == 1 { 16 } else { 8 };
        let total: u64 = if size32 == 1 {
            if pos + 16 > buf.len() {
                break;
            }
            u64::from_be_bytes([
                buf[pos + 8],
                buf[pos + 9],
                buf[pos + 10],
                buf[pos + 11],
                buf[pos + 12],
                buf[pos + 13],
                buf[pos + 14],
                buf[pos + 15],
            ])
        } else {
            size32 as u64
        };
        if total < header as u64 || pos + total as usize > buf.len() {
            break;
        }
        let content = &buf[pos + header..pos + total as usize];

        match &box_type {
            b"tfhd" => {
                if content.len() < 8 {
                    return Err("tfhd 过短".to_string());
                }
                let flags = fullbox_flags(content);
                let mut c = Cursor::new(&content[4..]);
                track_id = Some(read_u32(&mut c)?);
                if flags & TFHD_BASE_DATA_OFFSET != 0 {
                    tfhd_base = Some(read_u64(&mut c)?);
                }
                if flags & TFHD_DEFAULT_SAMPLE_DURATION != 0 {
                    def_duration = Some(read_u32(&mut c)?);
                }
                if flags & TFHD_DEFAULT_SAMPLE_SIZE != 0 {
                    def_size = Some(read_u32(&mut c)?);
                }
                if flags & TFHD_DEFAULT_SAMPLE_FLAGS != 0 {
                    def_flags = Some(read_u32(&mut c)?);
                }
                default_base_is_moof = flags & TFHD_DEFAULT_BASE_IS_MOOF != 0;
            }
            b"tfdt" => {
                if content.len() < 8 {
                    return Err("tfdt 过短".to_string());
                }
                let version = content[0];
                let mut c = Cursor::new(&content[4..]);
                dts = Some(if version == 1 {
                    read_u64(&mut c)?
                } else {
                    read_u32(&mut c)? as u64
                });
            }
            b"trun" => {
                if content.len() < 8 {
                    return Err("trun 过短".to_string());
                }
                let version = content[0];
                let flags = fullbox_flags(content);
                let mut c = Cursor::new(&content[4..]);
                let sample_count = read_u32(&mut c)?;

                let mut data_offset: i64 = 0;
                if flags & TRUN_DATA_OFFSET != 0 {
                    data_offset = read_i32(&mut c)? as i64;
                }
                let mut first_flags: Option<u32> = None;
                if flags & TRUN_FIRST_SAMPLE_FLAGS != 0 {
                    first_flags = Some(read_u32(&mut c)?);
                }
                let dur_p = flags & TRUN_SAMPLE_DURATION != 0;
                let size_p = flags & TRUN_SAMPLE_SIZE != 0;
                let flags_p = flags & TRUN_SAMPLE_FLAGS != 0;
                let cts_p = flags & TRUN_SAMPLE_CTS_OFFSET != 0;

                let mut dts_cursor = dts.unwrap_or(0);
                let mut cum: i64 = data_offset;
                for i in 0..sample_count {
                    let duration = if dur_p {
                        read_u32(&mut c)?
                    } else {
                        def_duration.ok_or("trun/tfhd 均无采样时长")?
                    };
                    let size = if size_p {
                        read_u32(&mut c)?
                    } else {
                        def_size.ok_or("trun/tfhd 均无采样大小")?
                    };
                    let raw_flags = if flags_p { Some(read_u32(&mut c)?) } else { None };
                    let cts_offset = if cts_p {
                        if version == 1 {
                            read_i32(&mut c)?
                        } else {
                            read_u32(&mut c)? as i32
                        }
                    } else {
                        0
                    };

                    let f = if i == 0 {
                        raw_flags.or(first_flags).or(def_flags)
                    } else {
                        raw_flags.or(def_flags)
                    };
                    let is_sync = match f {
                        Some(v) => v & SAMPLE_IS_NON_SYNC == 0,
                        None => true,
                    };

                    samples.push(SampleMeta {
                        offset: cum.max(0) as u64, // 相对 base
                        size,
                        dts: dts_cursor,
                        duration,
                        cts_offset,
                        is_sync,
                    });
                    dts_cursor = dts_cursor
                        .checked_add(duration as u64)
                        .ok_or("dts 溢出")?;
                    cum += size as i64;
                }
            }
            _ => {}
        }
        pos += total as usize;
    }

    let track_id = track_id.ok_or("traf 缺少 tfhd/track_id")?;
    let base: BaseKind = if let Some(o) = tfhd_base {
        BaseKind::Explicit(o)
    } else if default_base_is_moof {
        BaseKind::MoofStart
    } else {
        BaseKind::FollowMdat
    };
    Ok(PendingTraf {
        track_id,
        samples,
        base,
    })
}

fn read_u32<R: Read>(r: &mut R) -> Result<u32, String> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b).map_err(|e| e.to_string())?;
    Ok(u32::from_be_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> Result<u64, String> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b).map_err(|e| e.to_string())?;
    Ok(u64::from_be_bytes(b))
}

fn read_i32<R: Read>(r: &mut R) -> Result<i32, String> {
    Ok(read_u32(r)? as i32)
}

fn read_box_header_at<R: Read + Seek>(r: &mut R, pos: u64) -> Result<(u32, [u8; 4], u64), String> {
    r.seek(SeekFrom::Start(pos))
        .map_err(|e| format!("seek 失败: {}", e))?;
    let mut head = [0u8; 8];
    r.read_exact(&mut head)
        .map_err(|_| "读到文件末尾（box 头不完整）".to_string())?;
    let size32 = u32::from_be_bytes([head[0], head[1], head[2], head[3]]);
    let box_type = [head[4], head[5], head[6], head[7]];
    let total = if size32 == 1 {
        let mut ext = [0u8; 8];
        r.read_exact(&mut ext)
            .map_err(|_| "读到文件末尾（largesize 不完整）".to_string())?;
        u64::from_be_bytes(ext)
    } else {
        size32 as u64
    };
    Ok((size32, box_type, total))
}

fn read_at(f: &mut File, offset: u64, size: usize) -> Result<Vec<u8>, String> {
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("seek 到 {} 失败: {}", offset, e))?;
    let mut buf = Vec::with_capacity(size);
    let mut chunk = f.take(size as u64);
    chunk
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取采样数据失败: {}", e))?;
    if buf.len() != size {
        return Err(format!(
            "采样数据不完整：期望 {} 字节，实际 {}",
            size,
            buf.len()
        ));
    }
    Ok(buf)
}

// ---------------------------------------------------------------------------
// faststart 重排：ftyp+mdat+moov → ftyp+moov+mdat（stco/co64 偏移整体平移）
// ---------------------------------------------------------------------------

fn reorder_faststart(path: &Path) -> Result<(), String> {
    let mut f = File::open(path).map_err(|e| format!("打开输出文件失败: {}", e))?;
    let file_len = f.metadata().map_err(|e| e.to_string())?.len();

    // 定位顶层 box：期望 ftyp → mdat → moov
    let mut ftyp: Option<(u64, u64)> = None; // (start, total)
    let mut mdat: Option<(u64, u64, usize)> = None; // (start, total, header_len)
    let mut moov: Option<(u64, u64)> = None;
    let mut pos: u64 = 0;
    while pos < file_len {
        let (size32, box_type, total) = read_box_header_at(&mut f, pos)?;
        let header_len: usize = if size32 == 1 { 16 } else { 8 };
        match &box_type {
            b"ftyp" => ftyp = Some((pos, total)),
            b"mdat" => mdat = Some((pos, total, header_len)),
            b"moov" => moov = Some((pos, total)),
            _ => {}
        }
        if size32 == 0 {
            break;
        }
        pos += total;
    }
    let (Some((ftyp_start, ftyp_size)), Some((mdat_start, mdat_size, mdat_header)), Some((moov_start, moov_size))) =
        (ftyp, mdat, moov)
    else {
        return Err("输出文件缺少 ftyp/mdat/moov".to_string());
    };
    let _ = (ftyp_start, mdat_start);

    // mdat 新起点 = ftyp_size + moov_size（假设三 box 相邻；不相邻时用相对位移公式仍成立）
    let new_mdat_start = ftyp_size + moov_size;
    let delta = new_mdat_start as i64 - mdat_start as i64;

    // 读取 moov 并平移 stco/co64
    let mut moov_buf = vec![0u8; moov_size as usize];
    f.seek(SeekFrom::Start(moov_start))
        .and_then(|_| f.read_exact(&mut moov_buf))
        .map_err(|e| format!("读取 moov 失败: {}", e))?;
    patch_chunk_offsets(&mut moov_buf, delta)?;

    // 重写：ftyp + moov(patched) + mdat(头 + payload 流式复制)
    let tmp_path = path.with_extension("mp4.faststart.tmp");
    let mut w = BufWriter::new(File::create(&tmp_path).map_err(|e| format!("创建临时文件失败: {}", e))?);

    let mut ftyp_buf = vec![0u8; ftyp_size as usize];
    f.seek(SeekFrom::Start(0))
        .and_then(|_| f.read_exact(&mut ftyp_buf))
        .map_err(|e| format!("读取 ftyp 失败: {}", e))?;
    std::io::Write::write_all(&mut w, &ftyp_buf).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut w, &moov_buf).map_err(|e| e.to_string())?;

    // mdat 头（size + type [+ largesize]）
    let mut mdat_head = vec![0u8; mdat_header];
    f.seek(SeekFrom::Start(mdat_start))
        .and_then(|_| f.read_exact(&mut mdat_head))
        .map_err(|e| format!("读取 mdat 头失败: {}", e))?;
    std::io::Write::write_all(&mut w, &mdat_head).map_err(|e| e.to_string())?;

    // mdat payload 流式复制
    f.seek(SeekFrom::Start(mdat_start + mdat_header as u64))
        .map_err(|e| e.to_string())?;
    let payload_len = mdat_size - mdat_header as u64;
    let mut remaining = payload_len;
    let mut buf = vec![0u8; COPY_BUF_SIZE];
    while remaining > 0 {
        let n = remaining.min(COPY_BUF_SIZE as u64) as usize;
        f.read_exact(&mut buf[..n]).map_err(|e| format!("复制 mdat 失败: {}", e))?;
        std::io::Write::write_all(&mut w, &buf[..n]).map_err(|e| e.to_string())?;
        remaining -= n as u64;
    }
    std::io::Write::flush(&mut w).map_err(|e| e.to_string())?;
    drop(w);
    drop(f);

    std::fs::remove_file(path).map_err(|e| format!("移除旧文件失败: {}", e))?;
    std::fs::rename(&tmp_path, path).map_err(|e| format!("替换文件失败: {}", e))?;
    Ok(())
}

/// 递归扫描 moov 原始字节，把 stco/co64 的 chunk 偏移整体平移 delta
fn patch_chunk_offsets(buf: &mut [u8], delta: i64) -> Result<(), String> {
    const CONTAINERS: [&[u8; 4]; 5] = [b"moov", b"trak", b"mdia", b"minf", b"stbl"];
    let mut pos: usize = 0;
    while pos + 8 <= buf.len() {
        let size32 = u32::from_be_bytes([buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]]);
        let box_type = [buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]];
        let header: usize = if size32 == 1 { 16 } else { 8 };
        let total: u64 = if size32 == 1 {
            u64::from_be_bytes([
                buf[pos + 8],
                buf[pos + 9],
                buf[pos + 10],
                buf[pos + 11],
                buf[pos + 12],
                buf[pos + 13],
                buf[pos + 14],
                buf[pos + 15],
            ])
        } else {
            size32 as u64
        };
        if total < header as u64 || pos + total as usize > buf.len() {
            return Err("moov 内部 box 结构异常".to_string());
        }
        let content_start = pos + header;
        let content_end = pos + total as usize;
        match &box_type {
            b"stco" => {
                if content_end - content_start < 8 {
                    return Err("stco 过短".to_string());
                }
                let count = u32::from_be_bytes([
                    buf[content_start + 4],
                    buf[content_start + 5],
                    buf[content_start + 6],
                    buf[content_start + 7],
                ]) as usize;
                let mut off = content_start + 8;
                for _ in 0..count {
                    if off + 4 > content_end {
                        return Err("stco 条目越界".to_string());
                    }
                    let v = u32::from_be_bytes([
                        buf[off],
                        buf[off + 1],
                        buf[off + 2],
                        buf[off + 3],
                    ]);
                    let nv = (v as i64 + delta) as u64;
                    if nv > u32::MAX as u64 {
                        return Err("chunk 偏移超出 u32（文件 >4GB，需 co64）".to_string());
                    }
                    buf[off..off + 4].copy_from_slice(&(nv as u32).to_be_bytes());
                    off += 4;
                }
            }
            b"co64" => {
                if content_end - content_start < 8 {
                    return Err("co64 过短".to_string());
                }
                let count = u32::from_be_bytes([
                    buf[content_start + 4],
                    buf[content_start + 5],
                    buf[content_start + 6],
                    buf[content_start + 7],
                ]) as usize;
                let mut off = content_start + 8;
                for _ in 0..count {
                    if off + 8 > content_end {
                        return Err("co64 条目越界".to_string());
                    }
                    let v = u64::from_be_bytes([
                        buf[off],
                        buf[off + 1],
                        buf[off + 2],
                        buf[off + 3],
                        buf[off + 4],
                        buf[off + 5],
                        buf[off + 6],
                        buf[off + 7],
                    ]);
                    let nv = (v as i64 + delta) as u64;
                    buf[off..off + 8].copy_from_slice(&nv.to_be_bytes());
                    off += 8;
                }
            }
            t if CONTAINERS.contains(&t) => {
                patch_chunk_offsets(&mut buf[content_start..content_end], delta)?;
            }
            _ => {}
        }
        pos += total as usize;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use std::process::Command;

    fn ffmpeg() -> Option<std::path::PathBuf> {
        let p = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .join("node_modules")
            .join("ffmpeg-static")
            .join("ffmpeg.exe");
        p.exists().then_some(p)
    }

    /// 校验输出 mp4 顶层结构：ftyp → moov → mdat（faststart）
    fn assert_faststart(path: &Path) {
        let mut f = File::open(path).unwrap();
        let mut order = Vec::new();
        let mut pos = 0u64;
        let len = f.metadata().unwrap().len();
        while pos < len && order.len() < 4 {
            let (_, t, total) = read_box_header_at(&mut f, pos).unwrap();
            order.push(String::from_utf8_lossy(&t).to_string());
            if total == 0 {
                break;
            }
            pos += total;
        }
        assert_eq!(
            order.iter().take(3).collect::<Vec<_>>(),
            vec!["ftyp", "moov", "mdat"],
            "非 faststart 结构: {:?}",
            order
        );
    }

    #[test]
    fn test_remux_dash_samples() {
        let Some(ffmpeg) = ffmpeg() else {
            eprintln!("ffmpeg-static 不存在，跳过测试");
            return;
        };
        let dir = std::env::temp_dir().join(format!("dashmux_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let frag = "+frag_keyframe+empty_moov+default_base_moof";

        let video_m4s = dir.join("video.m4s");
        let audio_m4s = dir.join("audio.m4s");
        let out = dir.join("merged.mp4");

        // 2 秒 30fps H.264 测试视频（分片 fMP4，与 B 站 DASH m4s 同构）
        let r = Command::new(&ffmpeg)
            .args(["-y", "-v", "error", "-f", "lavfi", "-i",
                   "testsrc=duration=2:size=320x240:rate=30",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4",
                   "-movflags", frag])
            .arg(&video_m4s)
            .status()
            .unwrap();
        assert!(r.success(), "生成测试视频失败");

        // 2 秒 AAC 立体声（分片 fMP4）
        let r = Command::new(&ffmpeg)
            .args(["-y", "-v", "error", "-f", "lavfi", "-i",
                   "sine=frequency=440:duration=2",
                   "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
                   "-f", "mp4", "-movflags", frag])
            .arg(&audio_m4s)
            .status()
            .unwrap();
        assert!(r.success(), "生成测试音频失败");

        // 原生 remux
        remux_dash_to_mp4(&video_m4s, &audio_m4s, &out)
            .unwrap_or_else(|e| panic!("remux 失败: {e}"));
        assert!(out.exists());
        assert!(out.metadata().unwrap().len() > 10_000, "输出文件过小");
        assert_faststart(&out);

        // 用 ffmpeg 完整解码校验（无错误输出）
        let decode = Command::new(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&out)
            .args(["-f", "null", "-"])
            .output()
            .unwrap();
        assert!(
            decode.status.success(),
            "解码失败: {}",
            String::from_utf8_lossy(&decode.stderr)
        );

        // 时长校验（mp4 crate 解析输出）
        let check = open_reader(&out).unwrap();
        assert_eq!(check.tracks().len(), 2);
        assert!(
            check.duration() > Duration::from_millis(1500),
            "时长异常: {:?}",
            check.duration()
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_remux_legacy_fragments() {
        let Some(ffmpeg) = ffmpeg() else {
            eprintln!("ffmpeg-static 不存在，跳过测试");
            return;
        };
        let dir = std::env::temp_dir().join(format!("dashmux_legacy_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let video_m4s = dir.join("video.m4s");
        let audio_m4s = dir.join("audio.m4s");
        let out = dir.join("merged.mp4");

        // legacy 分片（隐式 base：mdat 跟随 moof）
        let r = Command::new(&ffmpeg)
            .args(["-y", "-v", "error", "-f", "lavfi", "-i",
                   "testsrc=duration=2:size=320x240:rate=30",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mp4",
                   "-movflags", "+frag_keyframe"])
            .arg(&video_m4s)
            .status()
            .unwrap();
        assert!(r.success(), "生成测试视频失败");
        let r = Command::new(&ffmpeg)
            .args(["-y", "-v", "error", "-f", "lavfi", "-i",
                   "sine=frequency=440:duration=2",
                   "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
                   "-f", "mp4", "-movflags", "+frag_keyframe"])
            .arg(&audio_m4s)
            .status()
            .unwrap();
        assert!(r.success(), "生成测试音频失败");

        remux_dash_to_mp4(&video_m4s, &audio_m4s, &out)
            .unwrap_or_else(|e| panic!("remux 失败: {e}"));
        assert_faststart(&out);

        let decode = Command::new(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&out)
            .args(["-f", "null", "-"])
            .output()
            .unwrap();
        assert!(
            decode.status.success(),
            "解码失败: {}",
            String::from_utf8_lossy(&decode.stderr)
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
