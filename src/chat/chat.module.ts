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

@Module({
  imports: [
    DatabaseModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [QueueController],
  providers: [ChatGateway, ChatService, QueueService],
  exports: [ChatService, QueueService],
})
export class ChatModule {}
