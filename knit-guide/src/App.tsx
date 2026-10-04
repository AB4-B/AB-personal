import { useStore } from './store/store';
import { useRoute } from './ui/router';
import { ChartViewer } from './screens/ChartViewer';
import { Home } from './screens/Home';
import { NewProject } from './screens/NewProject';
import { Outline } from './screens/Outline';
import { PdfViewer } from './screens/PdfViewer';
import { ProjectDetail } from './screens/ProjectDetail';

export function App() {
  const loaded = useStore((s) => s.loaded);
  const { path } = useRoute();
  if (!loaded) return <div className="screen center">Loading…</div>;

  if (path[0] === 'new') return <NewProject />;
  if (path[0] === 'p' && path[1]) {
    const id = path[1];
    if (path[2] === 'outline') return <Outline projectId={id} />;
    if (path[2] === 'pdf') return <PdfViewer projectId={id} />;
    if (path[2] === 'chart' && path[3]) return <ChartViewer projectId={id} imageId={path[3]} />;
    return <ProjectDetail projectId={id} />;
  }
  return <Home />;
}
