<template>
  <div class="login-page" :class="{ dark: appStore.theme === 'dark' }">
    <!-- Background decoration -->
    <div class="bg-decoration">
      <div class="circle circle-1"></div>
      <div class="circle circle-2"></div>
      <div class="circle circle-3"></div>
    </div>

    <!-- Theme / Lang toggles -->
    <div class="top-actions">
      <a-button type="text" @click="appStore.toggleTheme()" class="toggle-btn">
        {{ appStore.theme === 'dark' ? '☀️' : '🌙' }}
      </a-button>
      <a-button type="text" @click="toggleLang()" class="toggle-btn lang-toggle">
        {{ appStore.locale === 'zh-CN' ? 'EN' : '中文' }}
      </a-button>
    </div>

    <!-- Login card -->
    <div class="login-card">
      <!-- Logo -->
      <div class="login-logo">
        <div class="logo-box">⚡</div>
        <div class="logo-text">
          <span class="logo-name">BCC</span>
          <span class="logo-sub">backer-cloud-claw</span>
        </div>
      </div>

      <h1 class="login-title">{{ t('auth.welcome') }}</h1>
      <p class="login-subtitle">{{ t('auth.subtitle') }}</p>

      <a-form layout="vertical" class="login-form" @submit.prevent="handleLogin">
        <a-form-item :label="t('auth.email')">
          <a-input
            v-model="email"
            :placeholder="t('auth.emailPlaceholder')"
            size="large"
            allow-clear
            @keyup.enter="handleLogin"
          >
            <template #prefix><span>📧</span></template>
          </a-input>
        </a-form-item>

        <a-form-item :label="t('auth.password')">
          <a-input-password
            v-model="password"
            :placeholder="t('auth.passwordPlaceholder')"
            size="large"
            @keyup.enter="handleLogin"
          >
            <template #prefix><span>🔑</span></template>
          </a-input-password>
        </a-form-item>

        <div class="login-row">
          <a-checkbox v-model="rememberMe">{{ t('auth.rememberMe') }}</a-checkbox>
          <a-link>{{ t('auth.forgotPassword') }}</a-link>
        </div>

        <a-alert v-if="errorMsg" type="error" :message="errorMsg" style="margin-bottom: 16px;" />

        <a-button
          type="primary"
          size="large"
          long
          :loading="loading"
          @click="handleLogin"
          class="login-btn"
        >
          {{ t('auth.loginBtn') }}
        </a-button>
      </a-form>

      <p class="demo-hint">
        <span v-if="appStore.locale === 'zh-CN'">演示模式：输入任意邮箱和密码即可登录</span>
        <span v-else>Demo mode: enter any email and password to sign in</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import { Message } from '@arco-design/web-vue';

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const appStore = useAppStore();

const email = ref('admin@bcc.ai');
const password = ref('password');
const rememberMe = ref(true);
const loading = ref(false);
const errorMsg = ref('');

function toggleLang() {
  appStore.changeLocale(appStore.locale === 'zh-CN' ? 'en-US' : 'zh-CN');
}

async function handleLogin() {
  errorMsg.value = '';
  if (!email.value) {
    errorMsg.value = t('auth.emailPlaceholder');
    return;
  }
  loading.value = true;
  await new Promise(r => setTimeout(r, 600)); // simulate
  const ok = authStore.login(email.value, password.value);
  loading.value = false;
  if (ok) {
    Message.success(t('auth.loginSuccess'));
    router.push('/chat');
  } else {
    errorMsg.value = t('auth.loginFailed');
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  position: relative;
  overflow: hidden;
}

.bg-decoration {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.circle {
  position: absolute;
  border-radius: 50%;
  opacity: 0.06;
}
.circle-1 {
  width: 500px; height: 500px;
  background: radial-gradient(circle, #165dff, transparent);
  top: -200px; right: -100px;
}
.circle-2 {
  width: 400px; height: 400px;
  background: radial-gradient(circle, #722ed1, transparent);
  bottom: -150px; left: -100px;
}
.circle-3 {
  width: 300px; height: 300px;
  background: radial-gradient(circle, #00b42a, transparent);
  top: 50%; left: 40%;
}

.top-actions {
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.toggle-btn {
  font-size: 16px !important;
  border-radius: 8px;
}

.lang-toggle {
  font-size: 13px !important;
  font-weight: 600;
}

.login-card {
  background: var(--bg-card);
  border-radius: 20px;
  padding: 40px 48px;
  width: 420px;
  box-shadow: var(--shadow-md), 0 0 0 1px var(--border-color);
  position: relative;
  z-index: 1;
}

.login-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.logo-box {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #165dff, #722ed1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}

.logo-text {
  display: flex;
  flex-direction: column;
}

.logo-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.logo-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.login-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.login-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 28px;
}

.login-form {
  margin-top: 8px;
}

.login-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.login-btn {
  height: 44px;
  font-size: 15px;
  border-radius: 10px;
}

.demo-hint {
  margin-top: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 10px;
  background: rgba(22, 93, 255, 0.04);
  border-radius: 8px;
  border: 1px dashed var(--border-color);
}
</style>
