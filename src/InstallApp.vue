<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const props = defineProps<{ hasImage: boolean }>();
const installed = ref(false), prompting = ref(false), guide = ref<HTMLDialogElement>();
const instructions = ref('打开浏览器菜单，选择「安装应用」或「添加到桌面」。若没有此选项，请使用 Chrome、Edge 或 Safari。');
let deferred: InstallPrompt | undefined;
let initialController = false, reloaded = false;

function beforeInstall(event: Event) { event.preventDefault(); deferred = event as InstallPrompt; }
function appInstalled() { installed.value = true; deferred = undefined; }
function standalone() {
  installed.value = window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}
function controllerChanged() {
  navigator.serviceWorker.controller?.postMessage({
    type: 'coepCredentialless', value: !('chrome' in window || 'netscape' in window),
  });
  // Never discard a picture or reload the editor for an application update.
  if (!initialController && !reloaded && !window.crossOriginIsolated && !props.hasImage) {
    reloaded = true; window.location.reload();
  }
}
async function install() {
  if (!deferred) { guide.value?.showModal(); return; }
  const event = deferred; deferred = undefined; prompting.value = true;
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === 'accepted') appInstalled();
  } catch { guide.value?.showModal(); }
  finally { prompting.value = false; }
}
onMounted(() => {
  standalone();
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    instructions.value = '点击浏览器的「分享」按钮，选择「添加到主屏幕」，然后点击「添加」。';
  } else if (/Safari/.test(agent) && !/Chrome|Chromium|Edg/.test(agent)) {
    instructions.value = '在 Mac Safari 中选择「文件」→「添加到程序坞」，或点击「分享」→「添加到程序坞」。';
  }
  window.addEventListener('beforeinstallprompt', beforeInstall);
  window.addEventListener('appinstalled', appInstalled);
  window.addEventListener('pageshow', standalone);
  if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
    initialController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    if (initialController) controllerChanged();
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi-serviceworker.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch(error => console.warn('应用离线缓存暂不可用：', error));
  }
});
onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', beforeInstall);
  window.removeEventListener('appinstalled', appInstalled);
  window.removeEventListener('pageshow', standalone);
  navigator.serviceWorker?.removeEventListener('controllerchange', controllerChanged);
});
</script>

<template>
  <button v-if="!installed" class="button button-quiet install-button" :disabled="prompting" @click="install"><span>{{ prompting ? '正在打开…' : '安装到桌面' }}</span></button>
  <dialog ref="guide" class="install-guide" aria-labelledby="install-heading" @click="($event.target === guide) && guide?.close()">
    <h2 id="install-heading">安装水印清除</h2>
    <p>{{ instructions }}</p>
    <p class="install-note">安装后可从桌面独立打开。首次清除需要联网下载模型；页面、模型与运行文件缓存完整时可离线使用。</p>
    <button class="button button-primary" @click="guide?.close()">知道了</button>
  </dialog>
</template>

<style scoped>
.install-guide{max-width:360px;width:calc(100% - 48px);border:1px solid #e5e0f5;border-radius:16px;padding:26px;color:#65616f;box-shadow:0 18px 70px #30224730}.install-guide::backdrop{background:#29233555}.install-guide h2{font-size:19px;color:#484152;margin:0 0 16px}.install-guide p{font-size:13px;line-height:1.9;margin:0 0 15px}.install-guide .install-note{font-size:11px;color:#9891a5}.install-guide .button{float:right}.header-actions .install-button span{display:inline}@media(max-width:450px){.install-button{padding:9px 8px;font-size:10px}}
</style>
