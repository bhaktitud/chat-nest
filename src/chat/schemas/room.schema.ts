import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

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
export class Room {
  @Prop({ required: true, unique: true, index: true })
  roomId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  createdBy: string;

  @Prop({ required: true, default: () => new Date(), index: true })
  createdAt: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);

// Add compound index
RoomSchema.index({ createdBy: 1, createdAt: -1 });
