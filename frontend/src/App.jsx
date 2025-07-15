import { useState, useEffect } from 'react';
import './App.css'; // You can add styling here

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // The URL for the backend API.
    // In production (with Nginx), we can use a relative path.
    // Nginx will proxy requests starting with /api to the backend service.
    const apiUrl = '/api/data';

    fetch(apiUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        setData(data);
        setLoading(false);
      })
      .catch(error => {
        console.error("Error fetching data:", error);
        setError("Failed to fetch data from the backend. Is the backend running?");
        setLoading(false);
      });
  }, []); 

  return (
    <div className="container">
      <header>
        <h1>React Frontend with FastAPI Backend</h1>
      </header>
      <main>
        <div className="card">
          <h2>Data from Backend:</h2>
          {loading && <p>Loading...</p>}
          {error && <p className="error">{error}</p>}
          {data && (
            <pre>
              <code>{JSON.stringify(data, null, 2)}</code>
            </pre>
          )}
        </div>
      </main>
      <footer>
        <p>A Dockerized Full-Stack Application</p>
      </footer>
    </div>
  );
}

export default App;

