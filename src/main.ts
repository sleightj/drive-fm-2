import { WebGLRenderer, Scene, PerspectiveCamera, Color } from 'three';

const app = document.getElementById('app')!;
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x0b0b1a);
const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
renderer.render(scene, camera);
const game = { state: 'title', info: () => ({ renderer: 'boot' }) };
(window as any).__DRIVE_FM__ = game;
window.addEventListener('keydown', () => { game.state = 'driving'; });
