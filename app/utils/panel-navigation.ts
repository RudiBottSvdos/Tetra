export interface PanelNavItem {
  label: string
  icon: string
  to: string
}

export const panelNavItems: PanelNavItem[] = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { label: 'Projekte', icon: 'i-lucide-folder-kanban', to: '/projects' },
  { label: 'Themen', icon: 'i-lucide-lightbulb', to: '/topics' },
  { label: 'Review', icon: 'i-lucide-clipboard-check', to: '/review' },
  { label: 'Zeitplan', icon: 'i-lucide-calendar-clock', to: '/schedule' },
  { label: 'Kosten', icon: 'i-lucide-wallet', to: '/costs' },
  { label: 'Kennzahlen', icon: 'i-lucide-chart-column', to: '/metrics' },
  { label: 'Einstellungen', icon: 'i-lucide-settings', to: '/settings' }
]
