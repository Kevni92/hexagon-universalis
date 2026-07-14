import { createApp } from '@/app/createApp';
import '@/style.css';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('App-Container #app wurde nicht gefunden.');
}

const app = createApp(root);
app.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
