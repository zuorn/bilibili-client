// 全局状态变量
// 此文件必须最先加载，所有其他模块依赖这些全局变量

const { ipcRenderer } = require('electron')

let currentUser = null
let currentPage = 'home'
let pageHistory = []

let defaultShortcuts = {
  focusSearch: { keys: [['ctrl', 'f'], ['ctrl', 'l']], label: '聚焦搜索框' },
  clearSearch: { keys: [['escape']], label: '取消搜索聚焦' },
  goBack: { keys: [['alt', 'arrowleft'], ['alt', 'arrowright']], label: '返回上一页' },
  openSettings: { keys: [['ctrl', 'shift', 's']], label: '打开设置' },
  openShortcutSettings: { keys: [['ctrl', 'shift', ',']], label: '打开快捷键设置' },
  closeWindow: { keys: [['ctrl', 'shift', 'q']], label: '关闭窗口/弹出框' },
  refresh: { keys: [['r']], label: '刷新当前页' },
  goTop: { keys: [['g', 'g']], label: '回到顶部' },
  scrollDown: { keys: [['d']], label: '向下翻半页' },
  scrollUp: { keys: [['e']], label: '向上翻半页' }
}

let userShortcuts = JSON.parse(JSON.stringify(defaultShortcuts))
let currentRecording = { id: null, index: null }
let shortcutsEnabled = true
let pendingGoTop = false

let pageStates = {
  home: { pageNum: 1, videos: [], loading: false, hasMore: true },
  popular: { pageNum: 1, videos: [], loading: false, hasMore: true, currentTab: 'comprehensive', currentRid: 0 },
  media: { cursor: '', loading: false, hasMore: true, data: null },
  search: { keyword: '', pageNum: 1, loading: false, hasMore: true, searchType: 'all', order: 'totalrank' },
  up: { mid: null, name: '', offset: '', loading: false, hasMore: true, currentTab: 'videos', dynamicOffset: '', hasMoreDynamics: true, dynamicLoading: false, isSelf: false },
  my: { historyCursor: null, hasMoreHistory: true, isHistoryLoading: false, tabsOriginalOffset: null, favoritesPageNum: 1, hasMoreFavorites: true, isFavoritesLoading: false, favoritesDefaultPageNum: 1, hasMoreFavoritesDefault: true, isFavoritesDefaultLoading: false, collectionsPageNum: 1, hasMoreCollections: true, isCollectionsLoading: false, toviewPageNum: 1, hasMoreToview: true, isToviewLoading: false },
  bangumi: { cursor: '', loading: false, hasMore: true, data: null },
  following: { mid: null, tagid: -1, pageNum: 1, loading: false, hasMore: true, groups: [], targetMid: null }
}

let currentQCode = null
let pollInterval = null
let qrStatusElement = null

const QR_LOADING_HTML =
  '<div class="qr-loading" aria-live="polite"><span class="qr-loading-spinner" aria-hidden="true"></span><span class="qr-loading-text">加载中</span></div>'

// 动态页面状态
let currentUpId = null
let currentDynamicOffset = ''
let dynamicHasMore = true
let isDynamicLoading = false
let followingListData = []
let clickedUpIds = new Set()
let lastClickedUpId = null

// 番剧全部页面状态
let bangumiAllState = {
  page: 1,
  hasMore: true,
  loading: false,
  total: 0,
  currentFilters: {
    area: -1,
    style_id: -1,
    season_version: -1,
    season_status: -1,
    spoken_language_type: -1,
    copyright: -1,
    is_finish: -1,
    year: -1,
    season_month: -1,
    type: 2,
    order: 3,
    index_type: 1,
    pub_date: -1
  }
}

const sortOptions = [
  { value: 0, label: '按关注数' },
  { value: 1, label: '按播放数' },
  { value: 2, label: '按更新时间' },
  { value: 3, label: '按评分' }
]

// 影视全部页面状态
let mediaAllState = {
  page: 1,
  hasMore: true,
  loading: false,
  total: 0,
  currentFilters: {
    area: -1,
    style_id: -1,
    release_date: -1,
    season_status: -1,
    type: 2,
    order: 1,
    index_type: 2
  }
}

const mediaSortOptions = [
  { value: 1, label: '综合排序' },
  { value: 2, label: '按播放数' },
  { value: 3, label: '按最近更新' }
]

let moreFilterButtonInitialized = false

// 快捷键访问键状态
let accesskeyEnabled = false
let accesskeyElements = []
let accesskeyLabels = []
let accesskeyInput = ''

// 关注页面状态
let followingState = {
  mid: null,
  tagid: -1,
  pageNum: 1,
  loading: false,
  hasMore: true,
  groups: []
}
