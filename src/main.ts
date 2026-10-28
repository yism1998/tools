import { createApp, createSSRApp } from 'vue';
import App from './App.vue';
import './style.css';
const create = import.meta.env.PROD ? createSSRApp : createApp;
create(App).mount('#app');
