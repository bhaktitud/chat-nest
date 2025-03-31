export class JoinRoomDto {
  username: string;
  roomId: string;
}

export class CreateRoomDto {
  roomId: string;
  roomName: string;
}

export class MessageDto {
  message: string;
}

export class TypingDto {
  isTyping: boolean;
}

export class RoomIdDto {
  room: string;
}

export class QueueStatsDto {
  totalMessages: number;
  pendingMessages: number;
  processedMessages: number;
  failedMessages: number;
  averageProcessingTime: number;
  messagesPerSecond: number;
  activeRooms: number;
  activeUsers: number;
}

export class QueueMessageDto {
  id: string;
  user: string;
  room: string;
  text: string;
  timestamp: Date;
  status: 'pending' | 'processed' | 'failed';
  processingTime?: number;
  error?: string;
}

export class QueueFilterDto {
  status?: 'pending' | 'processed' | 'failed' | 'all';
  room?: string;
  user?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}
