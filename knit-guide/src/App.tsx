import { isTextSource } from './model/helpers';
import { initStore, useStore } from './store/store';
import { TextViewer } from './screens/TextViewer';
import { useRoute } from './ui/router';
import { ChartViewer } from './screens/ChartViewer';
import { Home } from './screens/Home';
import { NewProject } from './screens/NewProject';
import { Knit } from './screens/Knit';
import { Outline } from './screens/Outline';
import { PatternCheck } from './screens/PatternCheck';
import { PdfViewer } from './screens/PdfViewer';
import { ProjectDetail } from './screens/ProjectDetail';

export function App() {
  const loaded = useStore((s) => s.loaded);
  const loadError = useStore((s) => s.loadError);
  const { path } = useRoute();
  const textSource = useStore((s) => {
    const pr = path[0] === 'p' ? s.projects[path[1]] : undefined;
    const pat = pr && s.patterns[pr.patternId];
    return !!pat && isTextSource(pat);
  });
  if (!loaded) return <div className="screen center">Loading…</div>;
  if (loadError) {
    // a library that could not be read is never shown as an empty one
    return (
      <div className="screen" data-testid="load-error">
        <div className="page-pad stack" style={{ paddingTop: 40 }}>
          <div className="warnbox review-box">
            <b>⚠ YOUR PROJECTS COULD NOT BE LOADED</b>
            <div>Nothing has been deleted or changed. The app has stopped so that nothing is written over your saved work.</div>
            <div className="small-text" style={{ marginTop: 6 }}>Reason: {loadError}</div>
          </div>
          <button className="btn primary" data-testid="load-retry" onClick={() => void initStore()}>TRY AGAIN</button>
          <p className="small-text muted" style={{ margin: 0 }}>If this keeps happening: close the app completely and reopen it, or restart the phone, then try again.</p>
        </div>
      </div>
    );
  }

  if (path[0] === 'new') return <NewProject />;
  if (path[0] === 'p' && path[1]) {
    const id = path[1];
    if (path[2] === 'knit') return <Knit projectId={id} />;
    if (path[2] === 'outline') return <Outline projectId={id} />;
    if (path[2] === 'check') return <PatternCheck projectId={id} />;
    if (path[2] === 'pdf') return textSource ? <TextViewer projectId={id} /> : <PdfViewer projectId={id} />;
    if (path[2] === 'chart' && path[3]) return <ChartViewer projectId={id} imageId={path[3]} />;
    return <ProjectDetail projectId={id} />;
  }
  return <Home />;
}
