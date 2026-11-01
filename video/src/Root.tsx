import { Composition } from "remotion";
import { Main } from "./Main";
import { FPS, H, TOTAL_FRAMES, W } from "./timeline";

export const Root = () => (
  <Composition id="SafeNavIntro" component={Main} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} defaultProps={{ bgm: true }} />
);
