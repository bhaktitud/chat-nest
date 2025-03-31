import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import * as io from 'socket.io-client';
import { setTimeout } from 'timers/promises';

describe('Chat Application (e2e)', () => {
  let app: INestApplication;
  let httpServer;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('AppController', () => {
    it('/ (GET)', () => {
      return request(httpServer).get('/').expect(200).expect('Hello World!');
    });
  });

  describe('QueueController', () => {
    it('/api/queue/stats (GET)', () => {
      return request(httpServer)
        .get('/api/queue/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('totalMessages');
          expect(res.body).toHaveProperty('pendingMessages');
          expect(res.body).toHaveProperty('processedMessages');
          expect(res.body).toHaveProperty('failedMessages');
          expect(res.body).toHaveProperty('activeRooms');
          expect(res.body).toHaveProperty('activeUsers');
        });
    });

    it('/api/queue/messages (GET)', () => {
      return request(httpServer)
        .get('/api/queue/messages')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('/api/queue/rooms (GET)', () => {
      return request(httpServer)
        .get('/api/queue/rooms')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('/api/queue/users (GET)', () => {
      return request(httpServer)
        .get('/api/queue/users')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('WebSocket Chat Gateway', () => {
    let clientSocket;

    beforeEach((done) => {
      // Connect to the Socket.io server
      clientSocket = io.connect(
        `http://localhost:${httpServer.address().port}`,
        {
          transports: ['websocket'],
          forceNew: true,
        },
      );

      clientSocket.on('connect', () => {
        done();
      });
    });

    afterEach(() => {
      if (clientSocket.connected) {
        clientSocket.disconnect();
      }
    });

    it('should handle ping-pong for heartbeat', (done) => {
      clientSocket.on('ping', () => {
        clientSocket.emit('pong');
      });

      // Wait for ping-pong cycle to complete
      setTimeout(1000).then(() => {
        expect(clientSocket.connected).toBe(true);
        done();
      });
    });

    it('should handle join room and receive room data', (done) => {
      clientSocket.on('roomData', (data) => {
        expect(data).toHaveProperty('room', 'test-room');
        expect(data).toHaveProperty('users');
        expect(Array.isArray(data.users)).toBe(true);
        done();
      });

      clientSocket.emit('join', {
        roomId: 'test-room',
        username: 'test-user',
      });
    });

    it('should handle sending and receiving messages', (done) => {
      // First join a room
      clientSocket.emit('join', {
        roomId: 'test-room',
        username: 'test-user-2',
      });

      // Ensure connection and room joining is complete
      setTimeout(500).then(() => {
        // Listen for message reception
        clientSocket.on('message', (message) => {
          expect(message).toHaveProperty('text', 'Hello from E2E test');
          expect(message).toHaveProperty('room', 'test-room');
          expect(message).toHaveProperty('user', 'test-user-2');
          done();
        });

        // Send a message
        clientSocket.emit('sendMessage', {
          message: 'Hello from E2E test',
        });
      });
    });

    it('should handle typing status updates', (done) => {
      // First join a room
      clientSocket.emit('join', {
        roomId: 'test-room',
        username: 'test-user-3',
      });

      // Ensure connection and room joining is complete
      setTimeout(500).then(() => {
        // Listen for typing status updates
        clientSocket.on('userTyping', (data) => {
          expect(data).toHaveProperty('username', 'test-user-3');
          expect(data).toHaveProperty('isTyping', true);
          done();
        });

        // Send typing status
        clientSocket.emit('typing', {
          isTyping: true,
        });
      });
    });

    it('should handle room creation', (done) => {
      // First join a room to establish a user
      clientSocket.emit('join', {
        roomId: 'test-room',
        username: 'test-user-4',
      });

      // Ensure connection and room joining is complete
      setTimeout(500).then(() => {
        // Listen for room creation confirmation
        clientSocket.on('roomCreateSuccess', (room) => {
          expect(room).toHaveProperty('id', 'new-test-room');
          expect(room).toHaveProperty('name', 'New Test Room');
          done();
        });

        // Create a new room
        clientSocket.emit('createRoom', {
          roomId: 'new-test-room',
          roomName: 'New Test Room',
        });
      });
    });

    it('should get available rooms', (done) => {
      clientSocket.on('availableRooms', (rooms) => {
        expect(Array.isArray(rooms)).toBe(true);
        // At least default rooms should be available
        expect(rooms.length).toBeGreaterThan(0);
        done();
      });

      clientSocket.emit('getRooms');
    });
  });
});
