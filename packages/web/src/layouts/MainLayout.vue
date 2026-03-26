<template>
  <div class="main-layout" :class="{ dark: appStore.theme === 'dark' }">
    <!-- Left icon nav (72px) -->
    <nav class="sidebar">
      <!-- Logo -->
      <div class="sidebar-logo">
        <span class="logo-icon">⚡</span>
      </div>

      <!-- Main nav items -->
      <div class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
          :title="t(item.labelKey)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ t(item.labelKey) }}</span>
        </router-link>
      </div>

      <!-- Bottom actions -->
      <div class="sidebar-bottom">
        <button class="nav-item" @click="appStore.toggleTheme()" :title="t('settings.theme')">
          <span class="nav-icon">{{ appStore.theme === 'dark' ? '☀️' : '🌙' }}</span>
        </button>
        <button class="nav-item lang-btn" @click="toggleLang()" :title="t('settings.language')">
          <span class="nav-label-sm">{{ appStore.locale === 'zh-CN' ? 'EN' : '中' }}</span>
        </button>
        <div class="nav-item user-avatar" @click="handleLogout" :title="authStore.user?.email">
          <span class="nav-icon">{{ authStore.user?.avatar || '👤' }}</span>
        </div>
      </div>
    </nav>

    <!-- Main content -->
    <div class="main-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();

const navItems = [
  { to: '/chat',      icon: '💬', labelKey: 'nav.chat' },
  { to: '/workers',   icon: '🤖', labelKey: 'nav.workers' },
  { to: '/scenes',    icon: '🗺️', labelKey: 'nav.scenes' },
  { to: '/org',       icon: '🏢', labelKey: 'nav.org' },
  { to: '/analytics', icon: '📊', labelKey: 'nav.analytics' },
  { to: '/skills',    icon: '🧩', labelKey: 'nav.skills' },
  { to: '/tools',     icon: '🔧', labelKey: 'nav.tools' },
  { to: '/settings',  icon: '⚙️', labelKey: 'nav.settings' },
];

function isActive(path: string) {
  return route.path.startsWith(path);
}

function toggleLang() {
  appStore.changeLocale(appStore.locale === 'zh-CN' ? 'en-US' : 'zh-CN');
}

function handleLogout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.main-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-base);
}

/* ─── Sidebar ──────────────────────────────────────────────────────────── */

.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: 100%;
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  z-index: 100;
}

.sidebar-logo {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #165dff, #722ed1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  cursor: default;
  flex-shrink: 0;
}

.logo-icon {
  font-size: 22px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  width: 100%;
  padding: 0 8px;
}

.sidebar-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0 8px;
}

.nav-item {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.45);
  border: none;
  background: transparent;
  transition: all 0.15s ease;
  position: relative;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.nav-item.active {
  background: rgba(22, 93, 255, 0.2);
  color: #4080ff;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  background: #4080ff;
  border-radius: 0 3px 3px 0;
}

.nav-icon {
  font-size: 20px;
  line-height: 1;
}

.nav-label {
  font-size: 10px;
  letter-spacing: 0.3px;
  line-height: 1;
}

.nav-label-sm {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.user-avatar {
  margin-top: 4px;
}

/* ─── Main Content ─────────────────────────────────────────────────────── */

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
