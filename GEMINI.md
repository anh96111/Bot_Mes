# Project Context: Bot_Mes

## Overview
This project is a unified customer support system that aggregates messages from **Facebook Messenger** and **Telegram** into a single **React Dashboard**. It allows agents to view, reply to, and manage conversations from multiple platforms in real-time.

## Architecture

The project is structured as a monorepo with two main components:

### 1. Backend (`fb-telegram-bot`)
A Node.js/Express server that acts as the central hub.
*   **Role:**
    *   Receives webhooks from Facebook Messenger.
    *   Polls/Receives updates from Telegram via `node-telegram-bot-api`.
    *   Stores conversation history and customer data in **PostgreSQL**.
    *   Provides a REST API for the dashboard to fetch data.
    *   Uses **Socket.IO** to push real-time message updates to the dashboard.
    *   Handles file uploads and message translation (LibreTranslate/DeepL).
*   **Entry Point:** `index.js`
*   **Key Dependencies:** `express`, `pg`, `socket.io`, `node-telegram-bot-api`, `multer`, `axios`.

### 2. Frontend (`dashboard`)
A React application for agents to interact with customers.
*   **Role:**
    *   Displays a list of conversations (filtered by unread status and time).
    *   Provides a chat interface (`ChatWindow`) for sending text and media.
    *   Manages customer labels and quick replies.
    *   Handles offline queuing of messages (`offlineQueue.js`).
*   **Key Technologies:** React 19, Tailwind CSS, Socket.IO Client.
*   **Key Paths:**
    *   `src/components/ChatWindow.jsx`: Main chat logic, message rendering, file handling.
    *   `src/pages/Dashboard.jsx`: Main layout, sidebar integration, socket connection management.
    *   `src/services/api.js`: REST API endpoints.

## Setup & Development

### Prerequisites
*   Node.js (v16+)
*   PostgreSQL Database

### Backend Setup (`fb-telegram-bot`)
1.  Navigate to `fb-telegram-bot`.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file based on `.env.example`:
    *   Configure Database URL (`DATABASE_URL`).
    *   Add Facebook App/Page credentials.
    *   Add Telegram Bot Token.
    *   Set `FRONTEND_URL` for CORS.
4.  Start the server:
    ```bash
    npm start      # Production
    npm run dev    # Development (requires nodemon)
    ```

### Frontend Setup (`dashboard`)
1.  Navigate to `dashboard`.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file:
    ```env
    REACT_APP_API_URL=http://localhost:3000
    ```
4.  Start the development server:
    ```bash
    npm start
    ```
    Access at `http://localhost:3000` (or port 3001 if backend is on 3000).

## Key Features & Conventions
*   **Real-time Sync:** The dashboard uses Socket.IO to receive messages instantly. It handles reconnection and state sync automatically.
*   **Offline Mode:** The frontend queues messages when offline and attempts to resend them when connectivity is restored.
*   **Translation:** Integrated translation features allowing agents to translate incoming/outgoing messages.
*   **File Handling:** Supports sending images, videos, and files. Large files are handled via `multer` on the backend.
*   **Code Style:**
    *   **Backend:** CommonJS modules (`require`).
    *   **Frontend:** Functional React components with Hooks (`useState`, `useEffect`, `useCallback`). Tailwind CSS for styling.

## Important Files
*   `fb-telegram-bot/index.js`: Main server file containing webhook logic, socket setup, and API routes.
*   `dashboard/src/services/socket.js`: Socket.IO service wrapper.
*   `dashboard/src/services/api.js`: Centralized API calls.
*   `ChatWindow.txt` & `Dashboard.txt`: Likely reference or backup files for the main components.

