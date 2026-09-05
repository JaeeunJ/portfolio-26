// @tempo-home — Tempo home canvas (the workspace Run button opens this). Managed marker; do not remove.
import { Canvas, RouteStoryboard } from "tempo-sdk/canvas";

export default function HomeCanvas() {
  return (
    <Canvas name="Home">
      <RouteStoryboard
        id="Home"
        route="/"
        layout={{ x: 0, y: 0, width: 600, height: 400 }}
      />
    </Canvas>
  );
}
