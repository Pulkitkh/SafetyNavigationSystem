import { AbsoluteFill } from "remotion";
import { Captions } from "./components/Captions";
import { Scene } from "./components/Scene";
import { Checkin } from "./scenes/Checkin";
import { Checks } from "./scenes/Checks";
import { DayNight } from "./scenes/DayNight";
import { Fastest } from "./scenes/Fastest";
import { Home } from "./scenes/Home";
import { Live } from "./scenes/Live";
import { NightStreet } from "./scenes/NightStreet";
import { Numbers } from "./scenes/Numbers";
import { Outro } from "./scenes/Outro";
import { Plan } from "./scenes/Plan";
import { Reveal } from "./scenes/Reveal";
import { Routine } from "./scenes/Routine";
import { Safest } from "./scenes/Safest";
import { Sos } from "./scenes/Sos";
import { Sound } from "./Sound";
import { loadFont, C } from "./theme";
import { sceneFrames } from "./timeline";

loadFont();

// Lines whose words are already on screen as big type: no caption on top.
const NO_CAPTION = new Set(["l07", "l08", "l16", "l17"]);

export const Main = ({ bgm }: { bgm: boolean }) => (
  <AbsoluteFill style={{ background: C.canvas }}>
    <Scene k="night" fadeIn={0}>
      <NightStreet dur={sceneFrames("night").dur} />
    </Scene>
    <Scene k="routine">
      <Routine />
    </Scene>
    <Scene k="numbers">
      <Numbers />
    </Scene>
    <Scene k="daynight">
      <DayNight />
    </Scene>
    <Scene k="fastest">
      <Fastest />
    </Scene>
    <Scene k="reveal" fadeIn={4}>
      <Reveal />
    </Scene>
    <Scene k="plan">
      <Plan />
    </Scene>
    <Scene k="checks">
      <Checks />
    </Scene>
    <Scene k="safest">
      <Safest />
    </Scene>
    <Scene k="live">
      <Live />
    </Scene>
    <Scene k="checkin">
      <Checkin />
    </Scene>
    <Scene k="sos">
      <Sos />
    </Scene>
    <Scene k="home">
      <Home />
    </Scene>
    <Scene k="outro" tail={0}>
      <Outro />
    </Scene>
    <Captions accentFor={() => C.brandInk} hide={NO_CAPTION} />
    <Sound bgm={bgm} />
  </AbsoluteFill>
);
