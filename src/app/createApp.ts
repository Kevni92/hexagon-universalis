import { SceneRenderer } from '@/rendering/SceneRenderer';

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

  let renderer: SceneRenderer | null = null;

  try {
    renderer = new SceneRenderer(viewport);
  } catch (error) {
    const status = root.querySelector<HTMLElement>('#status');
    if (status !== null) {
      status.textContent =
        error instanceof Error && error.message.includes('WebGL')
          ? 'WebGL konnte nicht initialisiert werden. Bitte aktiviere WebGL oder verwende einen aktuellen Browser.'
          : 'Die 3D-Szene konnte nicht initialisiert werden.';
      status.classList.add('status-error');
    }
  }

  return {
    start: () => renderer?.start(),
    dispose: () => {
      renderer?.dispose();
      root.replaceChildren();
    },
  };
}
