import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useVideoPlayer } from '@/lib/video/hooks';

import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS: Record<string, number> = {
  scene1: 15000,
  scene2: 15000,
  scene3: 15000,
  scene4: 15000,
  scene5: 15000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  scene1: Scene1,
  scene2: Scene2,
  scene3: Scene3,
  scene4: Scene4,
  scene5: Scene5,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div
      className="w-full h-screen bg-[#020617] overflow-hidden relative"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Persistent background blob 1 */}
      <motion.div
        className="absolute rounded-full blur-[100px] opacity-30 mix-blend-screen pointer-events-none"
        animate={{
          width: [60, 40, 80, 50, 70][sceneIndex] + 'vw',
          height: [60, 40, 80, 50, 70][sceneIndex] + 'vw',
          x: [-10, 40, -20, 50, 15][sceneIndex] + 'vw',
          y: [-10, 10, -30, -10, 5][sceneIndex] + 'vw',
          backgroundColor: [2, 4].includes(sceneIndex) ? '#10b981' : '#f59e0b',
        }}
        transition={{ duration: 3, ease: [0.16, 1, 0.3, 1] as const }}
      />

      {/* Persistent background blob 2 */}
      <motion.div
        className="absolute rounded-full blur-[120px] opacity-20 mix-blend-screen pointer-events-none"
        animate={{
          width: [40, 60, 50, 80, 100][sceneIndex] + 'vw',
          height: [40, 60, 50, 80, 100][sceneIndex] + 'vw',
          x: [50, -10, 60, -20, -10][sceneIndex] + 'vw',
          y: [20, 30, 10, -20, -30][sceneIndex] + 'vw',
          backgroundColor: [1, 3].includes(sceneIndex) ? '#1e293b' : '#34d399',
        }}
        transition={{ duration: 4, ease: [0.16, 1, 0.3, 1] as const }}
      />

      {/* Subtle grid */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
          backgroundSize: '4vw 4vw',
        }}
        animate={{
          opacity: sceneIndex === 4 ? 0.3 : 1,
          scale: [1, 1.05, 1.1, 1.05, 1][sceneIndex],
          rotate: sceneIndex === 2 ? 1 : sceneIndex === 4 ? -1 : 0,
        }}
        transition={{ duration: 4, ease: [0.16, 1, 0.3, 1] as const }}
      />

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
