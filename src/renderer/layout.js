const { ipcRenderer } = require('electron')
const contentFrame = document.getElementById('contentFrame')
const sidebar = document.getElementById('sidebar')
const searchInput = document.querySelector('.search-input')
const searchBtn = document.querySelector('.search-btn')

const pages = {
  home: 'home.html',
  dynamic: 'dynamic-page.html',
  my: 'my-page.html'
}

function navigateTo(page, params = {}) {
  let url = pages[page]
  if (Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString()
    url += '?' + queryString
  }
  contentFrame.src = url

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === page) {
      item.classList.add('active')
    }
  })
}

function updateSidebarActive(page) {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
    if (item.dataset.page === page) {
      item.classList.add('active')
    }
  })
}

sidebar.addEventListener('click', (e) => {
  const sidebarItem = e.target.closest('.sidebar-item')
  if (sidebarItem && sidebarItem.dataset.page) {
    navigateTo(sidebarItem.dataset.page)
  }
})

searchBtn.addEventListener('click', () => {
  const keyword = searchInput.value.trim()
  if (keyword) {
    contentFrame.src = `search.html?keyword=${encodeURIComponent(keyword)}`
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active')
    })
  }
})

searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const keyword = searchInput.value.trim()
    if (keyword) {
      contentFrame.src = `search.html?keyword=${encodeURIComponent(keyword)}`
      document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active')
      })
    }
  }
})

ipcRenderer.on('navigate-to-up', (event, mid) => {
  contentFrame.src = `up-profile.html?mid=${mid}`
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active')
  })
})

ipcRenderer.on('navigate-to-page', (event, page) => {
  navigateTo(page)
})

ipcRenderer.on('update-sidebar', (event, page) => {
  updateSidebarActive(page)
})

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'navigate') {
    if (e.data.page === 'home' || e.data.page === 'dynamic' || e.data.page === 'my') {
      navigateTo(e.data.page)
    } else if (e.data.page === 'up-profile' && e.data.mid) {
      contentFrame.src = `up-profile.html?mid=${e.data.mid}`
      document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active')
      })
    }
  }
})