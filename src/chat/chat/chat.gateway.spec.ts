import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { Socket, Server } from 'socket.io';
import {
  JoinRoomDto,
  MessageDto,
  TypingDto,
  CreateRoomDto,
  RoomIdDto,
} from '../dto/chat.dto';
import { Logger } from '@nestjs/common';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: ChatService;
  let logger: Logger;

  // Mock data
  const mockUser = {
    id: 'socket1',
    username: 'testuser',
    room: 'general',
    isOnline: true,
    isTyping: false,
    socketId: 'socket1',
  };

  const mockRoom = {
    id: 'general',
    name: 'General',
    createdBy: 'system',
    createdAt: new Date(),
  };

  const mockMessage = {
    id: 'msg1',
    user: 'testuser',
    text: 'Hello, world!',
    room: 'general',
    timestamp: new Date(),
    isSystem: false,
  };

  // Mock socket
  const mockSocket = {
    id: 'socket1',
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    disconnect: jest.fn(),
    on: jest.fn(),
  } as unknown as Socket;

  // Mock server
  const mockServer = {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
  } as unknown as Server;

  beforeEach(async () => {
    // Create mock implementations
    const mockChatService = {
      getUserBySocketId: jest.fn().mockImplementation((socketId: string) => {
        return socketId === mockUser.socketId ? mockUser : undefined;
      }),
      addUser: jest.fn().mockResolvedValue(mockUser),
      removeUser: jest.fn().mockResolvedValue(mockUser),
      getUsersInRoom: jest.fn().mockReturnValue([mockUser]),
      setUserTypingStatus: jest.fn().mockResolvedValue(mockUser),
      getAllRooms: jest.fn().mockResolvedValue([mockRoom]),
      getMessageHistory: jest.fn().mockResolvedValue([mockMessage]),
      getMessagesForRoom: jest.fn().mockResolvedValue([mockMessage]),
      addMessage: jest.fn().mockResolvedValue(mockMessage),
      createRoom: jest.fn().mockResolvedValue(mockRoom),
      removeUserFromRoom: jest.fn().mockResolvedValue(mockUser),
    };

    logger = new Logger('TestLogger');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ChatGateway,
          useFactory: () => {
            // Create gateway with custom logger
            const gateway = new ChatGateway(mockChatService as any);

            // Manually set server and mock private methods
            gateway.server = mockServer;
            gateway['isRateLimited'] = jest.fn().mockReturnValue(false);
            gateway['setupHeartbeatCheck'] = jest.fn();
            gateway['clearHeartbeatTimer'] = jest.fn();

            return gateway;
          },
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    chatService = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should set up heartbeat check for new connections', () => {
      const setupSpy = gateway['setupHeartbeatCheck'];

      gateway.handleConnection(mockSocket);

      expect(setupSpy).toHaveBeenCalledWith(mockSocket);
    });
  });

  describe('handleDisconnect', () => {
    it('should handle user disconnection', async () => {
      const clearSpy = gateway['clearHeartbeatTimer'];

      await gateway.handleDisconnect(mockSocket);

      expect(clearSpy).toHaveBeenCalledWith(mockSocket.id);
      expect(chatService.removeUser).toHaveBeenCalledWith(mockUser.id);
      expect(mockServer.to).toHaveBeenCalledWith(mockUser.room);
      expect(mockServer.emit).toHaveBeenCalled();
    });

    it('should handle non-existing user disconnection gracefully', async () => {
      jest
        .spyOn(chatService, 'getUserBySocketId')
        .mockReturnValueOnce(undefined);

      await gateway.handleDisconnect(mockSocket);

      expect(chatService.removeUser).not.toHaveBeenCalled();
    });
  });

  describe('handleJoin', () => {
    it('should handle a user joining a room', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomId: 'general',
        username: 'testuser',
      };

      await gateway.handleJoin(mockSocket, joinRoomDto);

      expect(chatService.addUser).toHaveBeenCalled();
      expect(mockSocket.join).toHaveBeenCalledWith(joinRoomDto.roomId);
      expect(mockSocket.emit).toHaveBeenCalledWith('messageHistory', [
        mockMessage,
      ]);
      expect(mockServer.to).toHaveBeenCalledWith(joinRoomDto.roomId);
      expect(mockServer.emit).toHaveBeenCalled();
    });

    it('should handle missing room or username', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomId: '',
        username: '',
      };

      await gateway.handleJoin(mockSocket, joinRoomDto);

      expect(chatService.addUser).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
    });

    it('should handle errors gracefully', async () => {
      const joinRoomDto: JoinRoomDto = {
        roomId: 'general',
        username: 'testuser',
      };

      jest
        .spyOn(chatService, 'addUser')
        .mockRejectedValueOnce(new Error('Test error'));

      await gateway.handleJoin(mockSocket, joinRoomDto);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
    });
  });

  describe('handleMessage', () => {
    it('should handle sending a message', async () => {
      const messageDto: MessageDto = {
        message: 'Hello, world!',
      };

      await gateway.handleMessage(mockSocket, messageDto);

      expect(chatService.addMessage).toHaveBeenCalled();
      expect(chatService.setUserTypingStatus).toHaveBeenCalledWith(
        mockSocket.id,
        false,
      );
      expect(mockSocket.to).toHaveBeenCalledWith(mockUser.room);
      expect(mockServer.to).toHaveBeenCalledWith(mockUser.room);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'message',
        expect.any(Object),
      );
    });

    it('should handle non-existing user', async () => {
      const messageDto: MessageDto = {
        message: 'Hello, world!',
      };

      jest
        .spyOn(chatService, 'getUserBySocketId')
        .mockReturnValueOnce(undefined);

      await gateway.handleMessage(mockSocket, messageDto);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
      expect(chatService.addMessage).not.toHaveBeenCalled();
    });

    it('should handle rate limiting', async () => {
      const messageDto: MessageDto = {
        message: 'Hello, world!',
      };

      jest.spyOn(gateway as any, 'isRateLimited').mockReturnValueOnce(true);

      await gateway.handleMessage(mockSocket, messageDto);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
      expect(chatService.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('handleTyping', () => {
    it('should handle typing status updates', async () => {
      const typingDto: TypingDto = {
        isTyping: true,
      };

      await gateway.handleTyping(mockSocket, typingDto);

      expect(chatService.setUserTypingStatus).toHaveBeenCalledWith(
        mockSocket.id,
        true,
      );
      expect(mockSocket.to).toHaveBeenCalledWith(mockUser.room);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'userTyping',
        expect.any(Object),
      );
    });

    it('should handle non-existing user', async () => {
      const typingDto: TypingDto = {
        isTyping: true,
      };

      jest
        .spyOn(chatService, 'getUserBySocketId')
        .mockReturnValueOnce(undefined);

      await gateway.handleTyping(mockSocket, typingDto);

      expect(chatService.setUserTypingStatus).not.toHaveBeenCalled();
    });
  });

  describe('handleCreateRoom', () => {
    it('should handle room creation', async () => {
      const createRoomDto: CreateRoomDto = {
        roomId: 'newroom',
        roomName: 'New Room',
      };

      await gateway.handleCreateRoom(mockSocket, createRoomDto);

      expect(chatService.createRoom).toHaveBeenCalled();
      expect(mockServer.emit).toHaveBeenCalledWith('roomCreated', mockRoom);
      expect(mockServer.emit).toHaveBeenCalledWith('availableRooms', [
        mockRoom,
      ]);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'roomCreateSuccess',
        mockRoom,
      );
    });

    it('should handle user not found with temporary user creation', async () => {
      const createRoomDto: CreateRoomDto = {
        roomId: 'user-newroom',
        roomName: 'New Room',
      };

      jest
        .spyOn(chatService, 'getUserBySocketId')
        .mockReturnValueOnce(undefined);

      await gateway.handleCreateRoom(mockSocket, createRoomDto);

      expect(chatService.addUser).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
    });
  });

  describe('handleGetRooms', () => {
    it('should return available rooms', async () => {
      await gateway.handleGetRooms(mockSocket);

      expect(chatService.getAllRooms).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('availableRooms', [
        mockRoom,
      ]);
    });

    it('should handle errors gracefully', async () => {
      jest
        .spyOn(chatService, 'getAllRooms')
        .mockRejectedValueOnce(new Error('Test error'));

      await gateway.handleGetRooms(mockSocket);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
    });
  });

  describe('handleGetMessageHistory', () => {
    it('should return message history for a room', async () => {
      const roomIdDto: RoomIdDto = {
        room: 'general',
      };

      await gateway.handleGetMessageHistory(mockSocket, roomIdDto);

      expect(chatService.getMessagesForRoom).toHaveBeenCalledWith(
        roomIdDto.room,
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('messageHistory', [
        mockMessage,
      ]);
    });

    it('should handle errors gracefully', async () => {
      const roomIdDto: RoomIdDto = {
        room: 'general',
      };

      jest
        .spyOn(chatService, 'getMessagesForRoom')
        .mockRejectedValueOnce(new Error('Test error'));

      await gateway.handleGetMessageHistory(mockSocket, roomIdDto);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', expect.any(Object));
    });
  });

  describe('handleLeaveRoom', () => {
    it('should handle a user leaving a room', async () => {
      await gateway.handleLeaveRoom(mockSocket, 'general');

      expect(mockSocket.leave).toHaveBeenCalledWith('general');
      expect(chatService.getUsersInRoom).toHaveBeenCalledWith('general');
      expect(mockServer.to).toHaveBeenCalledWith('general');
      expect(chatService.removeUserFromRoom).toHaveBeenCalledWith(
        mockUser.id,
        'general',
      );
    });

    it('should handle non-existing user or room gracefully', async () => {
      jest
        .spyOn(chatService, 'getUserBySocketId')
        .mockReturnValueOnce(undefined);

      await gateway.handleLeaveRoom(mockSocket, 'general');

      expect(chatService.removeUserFromRoom).not.toHaveBeenCalled();
    });
  });
});
