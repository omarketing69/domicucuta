import { useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ConversationsPanel from '../components/ConversationsPanel.jsx';
import CustomersPanel from '../components/CustomersPanel.jsx';

const TABS = [
  { id: 'conversations', label: 'Conversaciones', icon: '💬' },
  { id: 'customers', label: 'Clientes', icon: '👥' },
];

export default function Dashboard({ session, onLogout }) {
  const [activeTab, setActiveTab] = useState('conversations');

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        session={session}
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={onLogout}
      />
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        {activeTab === 'conversations' && <ConversationsPanel session={session} />}
        {activeTab === 'customers' && <CustomersPanel session={session} />}
      </main>
    </div>
  );
}
