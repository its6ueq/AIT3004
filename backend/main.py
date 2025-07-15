from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

origins = [
    "http://localhost",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"], 
)

@app.get("/")
def read_root():
    """A default root endpoint to confirm the API is running."""
    return {"message": "Welcome to the FastAPI backend!"}

@app.get("/api/data")
def get_data():
    """
    An example API endpoint that the React frontend will call.
    """
    return {
        "message": "Hello from the FastAPI backend!",
        "timestamp": "Tuesday, July 15, 2025 at 1:04 PM",
        "location": "Hanoi, Vietnam"
    }

