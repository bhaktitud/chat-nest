import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc: any, ret: any) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Message {
  @Prop({ required: true, unique: true, index: true })
  messageId: string;

  @Prop({ required: true, index: true })
  user: string;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true, index: true })
  room: string;

  @Prop({ required: true, index: true })
  timestamp: Date;

  @Prop({ default: false })
  isSystem: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ room: 1, timestamp: 1 });
MessageSchema.index({ user: 1, room: 1 });
