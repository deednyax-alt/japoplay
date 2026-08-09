const AVATARS = [
  'https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png',
  'https://raw.githubusercontent.com/movixcorp/MovixOpenSource/main/public/avatars/netflix/squid_game/soldat_masqu.png',
  'https://raw.githubusercontent.com/movixcorp/MovixOpenSource/main/public/avatars/netflix/squid_game/leader.png',
  'https://raw.githubusercontent.com/movixcorp/MovixOpenSource/main/public/avatars/netflix/squid_game/young-hee.png',
  'https://raw.githubusercontent.com/movixcorp/MovixOpenSource/main/public/avatars/marvel/marvel_avatar_1.png',
  'https://raw.githubusercontent.com/movixcorp/MovixOpenSource/main/public/avatars/marvel/marvel_avatar_2.png',
  'https://api.dicebear.com/7.x/fun-emoji/png?seed=NetflixBlue&backgroundColor=0071eb',
  'https://api.dicebear.com/7.x/fun-emoji/png?seed=NetflixYellow&backgroundColor=f5c518',
  'https://api.dicebear.com/7.x/fun-emoji/png?seed=NetflixPink&backgroundColor=e84393',
  'https://api.dicebear.com/7.x/fun-emoji/png?seed=NetflixGreen&backgroundColor=2ecc71',
  'https://images.unsplash.com/photo-1608889825205-eebdb9fc5806?auto=format&fit=crop&w=300&q=80',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80'
];

function getProfiles() {
  const data = localStorage.getItem('japoplay_profiles');
  if (data) {
    try {
      const list = JSON.parse(data);
      if (Array.isArray(list)) {
        // Filter out old default profiles if present ('1', '2', '3')
        const filtered = list.filter(p => p.id !== '1' && p.id !== '2' && p.id !== '3');
        if (filtered.length !== list.length) {
          localStorage.setItem('japoplay_profiles', JSON.stringify(filtered));
        }
        if (filtered.length > 0) {
          const updated = filtered.map((p, idx) => {
            if (!p.avatar || p.avatar.includes('photo-1534528741775') || p.avatar.includes('photo-1507003211169') || p.avatar.includes('photo-1494790108377') || p.avatar.includes('photo-1500648767791') || p.avatar.includes('photo-1524504388940') || p.avatar.includes('photo-1539571696357')) {
              p.avatar = AVATARS[idx % AVATARS.length];
            }
            return p;
          });
          localStorage.setItem('japoplay_profiles', JSON.stringify(updated));
          return updated;
        }
        return [];
      }
    } catch (err) {}
  }
  return [];
}

function getCurrentProfile() {
  const profiles = getProfiles();
  if (!profiles || profiles.length === 0) return null;
  const activeId = localStorage.getItem('japoplay_active_profile');
  return profiles.find(p => p.id === activeId) || profiles[0];
}

function setCurrentProfile(profileId) {
  localStorage.setItem('japoplay_active_profile', profileId);
  window.location.href = '/home';
}

function saveNewProfile(name, avatar) {
  const profiles = getProfiles();
  const newP = {
    id: Date.now().toString(),
    name: name || 'Mon Profil',
    avatar: avatar || AVATARS[0]
  };
  profiles.push(newP);
  localStorage.setItem('japoplay_profiles', JSON.stringify(profiles));
  setCurrentProfile(newP.id);
}

function updateProfile(profileId, newName, newAvatar) {
  let profiles = getProfiles();
  const p = profiles.find(item => item.id === profileId);
  if (p) {
    p.name = newName || p.name;
    p.avatar = newAvatar || p.avatar;
    localStorage.setItem('japoplay_profiles', JSON.stringify(profiles));
  }
}

function deleteProfile(profileId) {
  let profiles = getProfiles();
  profiles = profiles.filter(p => p.id !== profileId);
  localStorage.setItem('japoplay_profiles', JSON.stringify(profiles));
  if (profiles.length === 0) {
    localStorage.removeItem('japoplay_active_profile');
    window.location.href = '/profiles';
  } else if (localStorage.getItem('japoplay_active_profile') === profileId) {
    localStorage.setItem('japoplay_active_profile', profiles[0].id);
  }
}

function getWatchHistory() {
  const profile = getCurrentProfile();
  const key = 'japoplay_history_' + profile.id;
  const data = localStorage.getItem(key);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveWatchHistory(item) {
  if (!item || (!item.id && !item.url)) return;
  const profile = getCurrentProfile();
  const key = 'japoplay_history_' + profile.id;
  let history = getWatchHistory();

  history = history.filter(h => {
    if (item.type === 'movie' || item.type === 'iptv') {
      return !(h.id === item.id && h.type === item.type);
    }
    return !(h.id === item.id && h.type === item.type && String(h.season) === String(item.season) && String(h.episode) === String(item.episode));
  });

  const entry = {
    id: item.id || '',
    type: item.type || 'movie',
    title: item.title || 'Titre',
    poster: item.poster || '',
    season: item.season || 1,
    episode: item.episode || 1,
    currentTime: item.currentTime || 0,
    duration: item.duration || 0,
    progressPct: item.duration ? Math.min(Math.round((item.currentTime / item.duration) * 100), 100) : 0,
    updatedAt: Date.now()
  };

  history.unshift(entry);
  if (history.length > 50) history = history.slice(0, 50);
  localStorage.setItem(key, JSON.stringify(history));
}

function removeWatchHistoryItem(id, type, season, episode) {
  const profile = getCurrentProfile();
  const key = 'japoplay_history_' + profile.id;
  let history = getWatchHistory();
  history = history.filter(h => {
    if (type === 'movie' || type === 'iptv') {
      return !(h.id === id && h.type === type);
    }
    return !(h.id === id && h.type === type && String(h.season) === String(season) && String(h.episode) === String(episode));
  });
  localStorage.setItem(key, JSON.stringify(history));
}

function clearWatchHistory() {
  const profile = getCurrentProfile();
  const key = 'japoplay_history_' + profile.id;
  localStorage.removeItem(key);
}

function initRealtimeOnlineCounter() {
  const countEls = document.querySelectorAll('.online-count-val');
  if (countEls.length === 0) return;

  if (typeof EventSource !== 'undefined') {
    const evtSource = new EventSource('/api/online-count/stream');
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data && typeof data.count === 'number') {
          countEls.forEach(el => el.textContent = data.count);
        }
      } catch (err) {}
    };
  }

  setInterval(() => {
    fetch('/api/online-count')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.count === 'number') {
          countEls.forEach(el => el.textContent = data.count);
        }
      })
      .catch(() => {});
  }, 8000);
}

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  const profiles = getProfiles();

  if (profiles.length === 0 && path !== '/profiles' && path !== '/bot-check') {
    window.location.href = '/profiles';
    return;
  }

  initRealtimeOnlineCounter();

  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 40) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    });
  }

  const activeP = getCurrentProfile();
  if (activeP) {
    const currentAvatarEl = document.getElementById('currentAvatar');
    const currentNameEl = document.getElementById('currentName');
    if (currentAvatarEl) currentAvatarEl.src = activeP.avatar;
    if (currentNameEl) currentNameEl.textContent = activeP.name;
  }
});
