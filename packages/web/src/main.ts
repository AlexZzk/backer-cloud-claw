import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ArcoVue from '@arco-design/web-vue';
import ArcoVueIcon from '@arco-design/web-vue/es/icon';
import '@arco-design/web-vue/dist/arco.css';

import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(ArcoVue);
app.use(ArcoVueIcon);
app.use(i18n);

app.mount('#app');

// 应用启动后初始化数据（workers + models 从后端加载）
import { useWorkersStore } from './stores/workers';
import { useModelsStore } from './stores/models';

const workersStore = useWorkersStore();
const modelsStore = useModelsStore();

void workersStore.fetchWorkers();
void modelsStore.fetchModels();
