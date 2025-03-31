export interface User {
  id: string;
  username: string;
  room: string;
  isOnline: boolean;
  isTyping: boolean;
  socketId?: string;
}

export interface ChatRoom {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  room: string;
  timestamp: Date;
  isSystem: boolean;
}

export interface SystemMessage {
  user: {
    id: string;
    username: string;
  };
  text: string;
  timestamp: string;
  type: string;
}

export interface UserStatus {
  userId: string;
  username: string;
  isOnline: boolean;
}

export interface UserTyping {
  userId: string;
  username: string;
  isTyping: boolean;
}

export interface RoomData {
  room: string;
  users: User[];
}

export interface QueueStats {
  totalMessages: number;
  pendingMessages: number;
  processedMessages: number;
  failedMessages: number;
  averageProcessingTime: number; // in milliseconds
  messagesPerSecond: number;
  activeRooms: number;
  activeUsers: number;
}

export interface QueueMessage {
  id: string;
  user: string;
  room: string;
  text: string;
  timestamp: Date;
  status: 'pending' | 'processed' | 'failed';
  processingTime?: number; // in milliseconds
  error?: string;
}
