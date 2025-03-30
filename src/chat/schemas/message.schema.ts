import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true })
  messageId: string;

  @Prop({ required: true })
  user: string;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  room: string;

  @Prop({ required: true, default: () => new Date() })
  timestamp: Date;

  @Prop({ default: false })
  isSystem: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
