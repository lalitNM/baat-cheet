//setup basic express server
const express = require('express');
const app = express();
const http = require('http').Server(app);
var linkify = require('linkifyjs');
require('linkifyjs/plugins/hashtag')(linkify); // optional
var linkifyHtml = require('linkifyjs/html');
const io = require('socket.io')(http);
const index = require('./serve/index.js');
const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log("Server is running at http://127.0.0.1:" + http.address().port);
});
app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');
app.set('view options', {
  layout: false
});
//routing
app.use('/', index);
app.use(function (err, req, res, next) {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})
//list of rooms and number of users in particular room (default: lobby)
const rooms = [{
  name: 'lobby',
  description: 'Central Lobby',
  num_users: 1,
  users: ['Welcome Bot']
}];
io.on('connection', (socket) => {
  //When client requests for setting username
  socket.on('set username', (name) => {
    name = (name || "").trim()
    //if name is empty(null), do nothing
    if (!name) return socket.emit('user invalid', `This user name is invalid.`);
    //if username is not taken
    else if (rooms[0].users.indexOf(name) == -1) {
      rooms[0].users.push(name);
      //username is valid so user is set
      socket.emit('user set', {
        username: name,
        online: rooms[0].num_users + 1,
        online_users: rooms[0].users
      });
      //by default, user joins lobby
      socket.join('lobby');
      rooms[0].num_users++;
      //notify all users (except sender) that user joined
      socket.broadcast.emit('user joined', {
        username: name,
        online: rooms[0].num_users,
        online_users: rooms[0].users
      });
      socket.username = name;
      welcomeUser(socket, {
        sender: 'Welcome Bot',
        user: name,
        room: rooms[0].name
      });
      for (let i = 1; i < rooms.length; i++) {
        socket.emit('room created other', {
          room_name: rooms[i].name,
          description: rooms[i].description,
          online: rooms[i].num_users,
          online_users: rooms[0].users
        });
      }
    }
    //if username is taken
    else {
      socket.emit('user exists', name);
    }
  });
  // Welcome the user to the app
  const welcomeUser = (socket, data) => {
    io.to(socket.id).emit('welcome user', data)
  }
  //When client sends message
  socket.on('Message Request', (data) => {
    //if message is valid
    if (data.msg) {
      // Display message to all clients in room including sender
      // Linkify msg
      data.msg = linkifyHtml(data.msg);
      io.sockets["in"](data.room).emit('Display Message', {
        msg: data.msg,
        user: socket.username,
        room: data.room
      });
    }
  });
  //When client creates room
  socket.on('create room', (data) => {
    data.room_name = data.room_name.trim();
    //if room name is empty, do nothing
    if (data.room_name == null) {
      return;
    }
    //limit length of room name/description
    const maxRoomNameLength = 20;
    const maxDescriptionLength = 45;
    if (data.room_name.length > maxRoomNameLength) {
      data.room_name = data.room_name.substring(0, maxRoomNameLength - 1).concat("...");
    }
    if (data.description.length > maxDescriptionLength) {
      data.description = data.description.substring(0, maxDescriptionLength - 1).concat("...");
    }
    //check if room exists
    const roomIfExists = rooms.find(eachRoom => eachRoom.name === data.room_name);
    if (roomIfExists !== undefined) {
      socket.emit('room exists', data.room_name);
      return;
    }
    //room not taken so insert into room array
    rooms.push({
      name: data.room_name,
      description: data.description,
      num_users: 1,
      users: [socket.username]
    });
    socket.join(data.room_name);
    socket.emit('room created self', {
      room_name: data.room_name,
      description: data.description,
      online: 1,
      online_users: [socket.username]
    });
    socket.broadcast.emit('room created other', {
      room_name: data.room_name,
      description: data.description,
      online_users: [socket.username]
    });
  });
  //When user requests to join the room
  socket.on('join room', (room) => {
    socket.join(room.name);
    //update number of users in room
    const fetchedRoom = rooms.find(each => each.name === room.name);
    if (fetchedRoom !== undefined) {
      fetchedRoom.num_users++;
      fetchedRoom.users.push(socket.username);
      //update the user's info
      socket.emit('room joined', {
        name: room.name,
        online: fetchedRoom.num_users,
        online_users: fetchedRoom.users
      });
      //notify other users in room that someone joined
      socket["to"](room.name).broadcast.emit('user join', {
        username: socket.username,
        room: room.name,
        online: fetchedRoom.num_users,
        online_users: fetchedRoom.users
      });
    }
  });
  //When user requests to leave the room
  socket.on('leave room', (room) => {
    socket.leave(room.name);
    //update number of users in room
    const fetchedRoom = rooms.find(each => each.name === room.name);
    if (fetchedRoom !== undefined) {
      fetchedRoom.num_users--;
      const userIndexInRoom = fetchedRoom.users.indexOf(socket.username);
      if (userIndexInRoom > -1) {
        fetchedRoom.users.splice(userIndexInRoom, 1);
      }
    }
    //if users become 0, destroy/delete the room
    if (fetchedRoom !== undefined && fetchedRoom.num_users === 0) {
      io.sockets.emit('destroy room', room.name);
      rooms.splice(rooms.findIndex(eachRoom => eachRoom.name === room.name), 1);
      return;
    }
    //notify other users in room that someone left
    socket["to"](room.name).broadcast.emit('user left room', {
      username: socket.username,
      room: room.name,
      online: fetchedRoom.num_users,
      online_users: fetchedRoom.users
    });
  });
  //When user disconnets remove user from users
  socket.on('disconnecting', () => {
    let num_rooms = rooms.length;
    //update number of users in rooms
    for (let i = 0; i < num_rooms; i++) {
      if (socket.rooms[rooms[i].name]) {
        rooms[i].num_users--;
        const index = rooms[i].users.indexOf(socket.username);
        if (index != -1) {
          rooms[i].users.splice(index, 1);
        }
        //notify other users in room that user left
        //socket["to"](rooms[i].name).broadcast.emit('user left room', {username: socket.username, room: rooms[i].name});
        //if number of users become 0 in some room, destroy/delete that room
        if (rooms[i].num_users == 0 && rooms[i].name != 'lobby') {
          io.sockets.emit('destroy room', rooms[i].name);
          rooms.splice(i, 1);
          i--;
          num_rooms--;
        }
      }
    }
    io.sockets.emit('user left', {
      username: socket.username
    });
    io.sockets.emit('update info', rooms);
  });
});
module.exports = app;
