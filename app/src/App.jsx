import { Routes, Route, Link } from 'react-router-dom';

function Home() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ color: '#00B74A' }}>Holmdale Staff Portal — Admin</h1>
      <p>This is the new React app for staff/admin tools. Pages will be migrated here from the public repo over time.</p>
      <p>Existing kiosk and operations pages remain at their current paths under <code>/</code>.</p>
      <p><Link to="/">Manage home</Link></p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
