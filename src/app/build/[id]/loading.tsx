// Shown while the editor route streams in — matches the canvas backdrop so the
// transition from the dashboard feels instant. See linking-and-navigating docs:
// dynamic routes need a loading file to be partially prefetched.
export default function Loading() {
  return <div className="canvas-grid h-screen w-full" />;
}
