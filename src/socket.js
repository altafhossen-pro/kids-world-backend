let io;

module.exports = {
  init: (httpServer) => {
    const { Server } = require('socket.io');
    io = new Server(httpServer, {
      cors: {
        origin: [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://64.227.133.212',
          'http://kidsworldbd.com',
          'https://kidsworldbd.com',
          'http://www.kidsworldbd.com',
          'https://www.kidsworldbd.com',
          'http://api.kidsworldbd.com',
          'https://api.kidsworldbd.com',
          'http://64.227.133.212:3000'
        ],
        methods: ["GET", "POST"]
      }
    });
    return io;
  },
  getIo: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  }
};
