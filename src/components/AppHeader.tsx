import { IconPlugConnected, IconPlugOff } from '@tabler/icons-react';
import type { PoseSet } from '../metadata';

type AppHeaderProps = {
  page: 'overview' | 'create' | 'set' | 'slideshow' | 'sources';
  activeSet: PoseSet | null;
  isConnected: boolean;
  showSources: boolean;
  onConnect: () => void;
  onTitleClick: () => void;
  onNavigate: (page: 'overview' | 'create' | 'set' | 'slideshow' | 'sources') => void;
};

export function AppHeader({
  page,
  activeSet,
  isConnected,
  showSources,
  onConnect,
  onTitleClick,
  onNavigate,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <button type="button" className="title topbar-title" onClick={onTitleClick}>
        Pose Viewer
      </button>
      <div className="auth-chip">
        <button
          className={`connection-button ${isConnected ? 'is-connected' : 'is-disconnected'}`}
          onClick={onConnect}
          type="button"
          aria-label={isConnected ? 'Reconnect to Google Drive' : 'Connect to Google Drive'}
          title={isConnected ? 'Reconnect' : 'Connect'}
        >
          {isConnected ? <IconPlugConnected size={18} /> : <IconPlugOff size={18} />}
        </button>
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
        {showSources ? (
          <button
            type="button"
            className={`nav-tab ${page === 'sources' ? 'is-active' : ''}`}
            onClick={() => onNavigate('sources')}
          >
            Sources
          </button>
        ) : null}
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
