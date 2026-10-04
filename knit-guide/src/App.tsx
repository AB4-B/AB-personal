import { isTextSource } from './model/helpers';
import { useStore } from './store/store';
import { TextViewer } from './screens/TextViewer';
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
  const textSource = useStore((s) => {
    const pr = path[0] === 'p' ? s.projects[path[1]] : undefined;
    const pat = pr && s.patterns[pr.patternId];
    return !!pat && isTextSource(pat);
  });
  if (!loaded) return <div className="screen center">Loading…</div>;

  if (path[0] === 'new') return <NewProject />;
  if (path[0] === 'p' && path[1]) {
    const id = path[1];
    if (path[2] === 'outline') return <Outline projectId={id} />;
    if (path[2] === 'pdf') return textSource ? <TextViewer projectId={id} /> : <PdfViewer projectId={id} />;
    if (path[2] === 'chart' && path[3]) return <ChartViewer projectId={id} imageId={path[3]} />;
    return <ProjectDetail projectId={id} />;
  }
  return <Home />;
}
