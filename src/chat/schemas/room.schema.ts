import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

@Schema({ timestamps: true })
export class Room {
  @Prop({ required: true, unique: true })
  roomId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  createdBy: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
