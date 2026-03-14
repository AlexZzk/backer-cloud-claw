import { defineStore } from 'pinia';
import { ref } from 'vue';
import { skillsApi, type ApiSkill, type ApiSkillStats, type ApiHubSkill } from '@/api/client';

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<ApiSkill[]>([]);
  const stats = ref<ApiSkillStats>({ builtin: 0, user: 0, project: 0 });
  const hubResults = ref<ApiHubSkill[]>([]);
  const loading = ref(false);
  const hubLoading = ref(false);

  async function fetchSkills() {
    loading.value = true;
    try {
      const data = await skillsApi.list();
      skills.value = data.skills;
      stats.value = data.stats;
    } catch {
      skills.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function createSkill(data: { name: string; description: string; prompt: string; system?: string }) {
    const skill = await skillsApi.create(data);
    await fetchSkills();
    return skill;
  }

  async function deleteSkill(name: string) {
    await skillsApi.delete(name);
    await fetchSkills();
  }

  async function searchHub(query: string) {
    if (!query.trim()) { hubResults.value = []; return; }
    hubLoading.value = true;
    try {
      const data = await skillsApi.searchHub(query);
      hubResults.value = data.skills;
    } catch {
      hubResults.value = [];
    } finally {
      hubLoading.value = false;
    }
  }

  return {
    skills,
    stats,
    hubResults,
    loading,
    hubLoading,
    fetchSkills,
    createSkill,
    deleteSkill,
    searchHub,
  };
});
