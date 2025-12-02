# Modable

An AI-powered agentic workforce for adding features to your applications. Modable uses GPT-4 to explore your codebase, understand your project structure, plan changes, and implement features autonomously.

## Features

- **Project Explorer**: Browse and search your codebase with a beautiful file tree interface
- **Agentic AI**: GPT-4 powered agent that can read, understand, and modify your code
- **Safe Changes**: Review all proposed changes in a diff viewer before applying them
- **Auto Backups**: Every file modification is backed up before changes are applied

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenAI API key (get one at https://platform.openai.com/api-keys)

### Installation

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev
```

### Usage

1. Launch Modable
2. Enter your OpenAI API key (stored locally, never sent to our servers)
3. Click "Open Project" and select a folder containing your application code
4. Describe the feature you want to add in the chat panel
5. Watch as the agent explores your codebase and implements the feature
6. Review and accept/reject the proposed changes

## Tech Stack

- **Electron** - Cross-platform desktop app
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **OpenAI GPT-4** - AI agent
- **Monaco Editor** - Code viewing
- **Zustand** - State management

## Project Structure

```
modable/
├── electron/           # Electron main process
│   ├── main.ts        # Window management, IPC handlers
│   └── preload.ts     # Context bridge for renderer
├── src/
│   ├── components/    # React UI components
│   ├── agent/         # AI agent logic
│   ├── stores/        # Zustand state management
│   └── lib/           # Utility functions
└── public/            # Static assets
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run electron:build
```

## License

MIT




