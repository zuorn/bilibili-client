const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

async function getDanmakuXml(cid) {
  const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  
  let xmlData;
  try {
    xmlData = await gunzip(res.data);
    xmlData = xmlData.toString('utf8');
  } catch (e) {
    xmlData = res.data.toString('utf8');
  }
  
  return xmlData;
}

async function getCidByBvid(bvid) {
  const url = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}&jsonp=jsonp`;
  const res = await axios.get(url);
  if (res.data.code === 0 && res.data.data && res.data.data.length > 0) {
    return res.data.data[0].cid;
  }
  throw new Error('Failed to get cid');
}

module.exports = { getDanmakuXml, getCidByBvid };