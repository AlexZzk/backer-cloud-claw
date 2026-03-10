import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserProfile | null>(
    JSON.parse(localStorage.getItem('bcc-user') || 'null')
  );

  const isLoggedIn = computed(() => user.value !== null);

  function login(email: string, _password: string): boolean {
    // Mock login — accept any credentials with valid email format
    if (!email.includes('@')) return false;

    const profile: UserProfile = {
      id: 'user-1',
      name: email.split('@')[0] || 'User',
      email,
      avatar: '🧑',
    };
    user.value = profile;
    localStorage.setItem('bcc-user', JSON.stringify(profile));
    return true;
  }

  function logout() {
    user.value = null;
    localStorage.removeItem('bcc-user');
  }

  return { user, isLoggedIn, login, logout };
});
