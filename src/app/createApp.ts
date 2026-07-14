import { DemoRenderer } from '@/rendering/DemoRenderer';

export interface App {
  start(): void;
  dispose(): void;
}

export function createApp(root: HTMLElement): App {
  root.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <p class="eyebrow">Projektgrundlage</p>
        <h1>Hexagon Universalis</h1>
        <p id="status" class="status" role="status">Three.js-Testszene bereit</p>
      </header>
      <section class="viewport" aria-label="Interaktive 3D-Testszene"></section>
    </main>
  `;

  const viewport = root.querySelector<HTMLElement>('.viewport');

  if (viewport === null) {
    throw new Error('Rendering-Container wurde nicht angelegt.');
  }

  const renderer = new DemoRenderer(viewport);

  return {
    start: () => renderer.start(),
    dispose: () => {
      renderer.dispose();
      root.replaceChildren();
    },
  };
}
