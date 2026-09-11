import * as THREE from "three";

const canvas = document.getElementById("bg-canvas");
if (canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const mouse = { x: 0, y: 0 };
  window.addEventListener("mousemove", (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // Distant stars
  const starCount = 900;
  const starsGeo = new THREE.BufferGeometry();
  const starsPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount * 3; i += 3) {
    starsPos[i] = (Math.random() - 0.5) * 160;
    starsPos[i + 1] = (Math.random() - 0.5) * 160;
    starsPos[i + 2] = (Math.random() - 0.5) * 160;
  }
  starsGeo.setAttribute("position", new THREE.BufferAttribute(starsPos, 3));
  const starsMat = new THREE.PointsMaterial({ color: 0x818cf8, size: 0.12, transparent: true, opacity: 0.7 });
  const stars = new THREE.Points(starsGeo, starsMat);
  scene.add(stars);

  // Central dodecahedron "artifact"
  const geo = new THREE.IcosahedronGeometry(9, 1);
  const wire = new THREE.MeshBasicMaterial({ color: 0x9f6bff, wireframe: true, transparent: true, opacity: 0.28 });
  const core = new THREE.Mesh(geo, wire);
  scene.add(core);

  // Orbiting particles ring
  const ringCount = 400;
  const ringGeo = new THREE.BufferGeometry();
  const ringPos = new Float32Array(ringCount * 3);
  for (let i = 0; i < ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2;
    const radius = 24 + Math.random() * 6;
    ringPos[i * 3] = Math.cos(angle) * radius;
    ringPos[i * 3 + 1] = (Math.random() - 0.5) * 3;
    ringPos[i * 3 + 2] = Math.sin(angle) * radius;
  }
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
  const ring = new THREE.Points(ringGeo, new THREE.PointsMaterial({ color: 0x63e2ff, size: 0.16, transparent: true, opacity: 0.8 }));
  scene.add(ring);

  camera.position.z = 45;

  const animate = () => {
    requestAnimationFrame(animate);
    core.rotation.x += 0.0018;
    core.rotation.y += 0.0024;
    ring.rotation.y += 0.0008;
    stars.rotation.y += 0.0003;
    camera.position.x += (mouse.x * 3 - camera.position.x) * 0.04;
    camera.position.y += (mouse.y * 2 - camera.position.y) * 0.04;
    camera.lookAt(scene.position);
    renderer.render(scene, camera);
  };
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const backgroundOff = document.documentElement.dataset.bg === "off";
  if (prefersReducedMotion || backgroundOff) {
    renderer.render(scene, camera);
  } else {
    animate();
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}