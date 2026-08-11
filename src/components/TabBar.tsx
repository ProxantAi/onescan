interface TabBarProps {
  activeTab: string;
  onTabClick: (id: string) => void;
}

export function TabBar({ activeTab, onTabClick }: TabBarProps) {
  const tabs = [
    { id: "landing", label: "Inicio", cta: false },
    { id: "results", label: "Historial", cta: false },
    { id: "scan", label: "Nuevo Check", cta: true },
    { id: "results", label: "Reportes", cta: false },
    { id: "landing", label: "Perfil", cta: false },
  ];

  return (
    <nav className="tabbar">
      {tabs.map((tab, i) => (
        <button
          key={`${tab.id}-${i}`}
          type="button"
          className={`tab${tab.cta ? " tab--cta" : ""}${activeTab === tab.id && !tab.cta ? " is-active" : ""}`}
          data-tab={tab.id}
          onClick={() => onTabClick(tab.id)}
        >
          {tab.cta ? (
            <span className="tab__fab">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                <rect x="3" y="7" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="13.5" r="3.2" stroke="currentColor" strokeWidth="2" />
                <path d="M9 7l1.5-2h3L15 7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </span>
          ) : i === 0 ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path
                d="M3 10.5 12 3l9 7.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 9.5V20h14V9.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : i === 1 ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : i === 3 ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path d="M6 3h9l3 3v15H6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path
                d="M9 12l2 2 4-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="2" />
              <path
                d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
