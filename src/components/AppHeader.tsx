import type { PoseSet } from '../metadata';

type AppHeaderProps = {
  page: 'overview' | 'create' | 'set' | 'slideshow';
  activeSet: PoseSet | null;
  isConnected: boolean;
  onConnect: () => void;
  onNavigate: (page: 'overview' | 'create' | 'set' | 'slideshow') => void;
};

export function AppHeader({ page, activeSet, isConnected, onConnect, onNavigate }: AppHeaderProps) {
  return (
    <header className="topbar">
      <button type="button" className="title topbar-title" onClick={() => onNavigate('overview')}>
        Pose Viewer
      </button>
      <div className="auth-chip">
        <button className="chip-button" onClick={onConnect}>
          {isConnected ? 'Reconnect' : 'Connect'}
        </button>
        {isConnected ? <span className="chip-status">Connected</span> : null}
      </div>
      <div className="nav-tabs">
        <button
          type="button"
          className={`nav-tab ${page === 'overview' ? 'is-active' : ''}`}
          onClick={() => onNavigate('overview')}
        >
          Sets
        </button>
        <button
          type="button"
          className={`nav-tab ${page === 'create' ? 'is-active' : ''}`}
          onClick={() => onNavigate('create')}
        >
          Create
        </button>
        <button
          type="button"
          className={`nav-tab ${page === 'slideshow' ? 'is-active' : ''}`}
          onClick={() => onNavigate('slideshow')}
        >
          Slideshow
        </button>
        {activeSet ? (
          <button
            type="button"
            className={`nav-tab ${page === 'set' ? 'is-active' : ''}`}
            onClick={() => onNavigate('set')}
          >
            Viewer
          </button>
        ) : null}
      </div>
    </header>
  );
}
