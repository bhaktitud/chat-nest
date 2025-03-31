import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatGateway } from './chat/chat.gateway';
import { ChatService } from './chat/chat.service';
import { DatabaseModule } from '../database/database.module';
import { Message, MessageSchema } from './schemas/message.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { User, UserSchema } from './schemas/user.schema';
import { QueueService } from './queue/queue.service';
import { QueueController } from './queue/queue.controller';
import { APP_FILTER } from '@nestjs/core';
import { WebSocketExceptionFilter } from '../monitoring/ws-exception.filter';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [
    DatabaseModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    MonitoringModule,
  ],
  controllers: [QueueController],
  providers: [
    ChatGateway,
    ChatService,
    QueueService,
    {
      provide: APP_FILTER,
      useClass: WebSocketExceptionFilter,
    },
  ],
  exports: [ChatService, QueueService],
})
export class ChatModule {}
