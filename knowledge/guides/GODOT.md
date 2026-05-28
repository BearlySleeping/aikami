# Godot Client

This document provides an overview of the Godot client and its interaction with the Firebase backend.

## Overview

The Godot client is a 2D top-down RPG built with the Godot Engine. It communicates with our backend services to fetch game data, process player actions, and receive real-time updates.

## Interaction with Firebase

The Godot client interacts with the Firebase backend through a set of custom-built C# classes that wrap the Firebase C# SDK. These classes provide a simple and easy-to-use API for interacting with Firebase services.

### Authentication

The Godot client uses Firebase Authentication to authenticate users. When a user signs in or signs up, the client sends a request to the Firebase Authentication service to get an ID token. This token is then sent to the backend with every request to authenticate the user.

### Firestore

The Godot client uses Firestore to store and retrieve game data. The client uses the Firebase C# SDK to listen for real-time updates to the database. This allows the client to display up-to-date information to the user without having to poll the database for changes.

The following is a list of the Firestore collections that the Godot client interacts with:

-   `users`: This collection contains all the user data.
-   `characters`: This collection contains all the character data.
-   `personas`: This collection contains all the persona data.
-   `npcs`: This collection contains all the NPC data.
-   `messages`: This collection contains all the message data.

### Firebase Storage

The Godot client uses Firebase Storage to store and retrieve user-generated content, such as character avatars.

### Firebase Functions

The Godot client uses Firebase Functions to trigger backend logic. For example, when a user sends a message, the client calls a Firebase Function to process the message and send it to the other users in the chat.

## API

The Godot client uses a set of custom-built C# classes to interact with the Firebase backend. These classes provide a simple and easy-to-use API for interacting with Firebase services.

The following is a list of the main classes that the Godot client uses:

-   `FirebaseAuth.cs`: This class provides an API for authenticating users.
-   `Firestore.cs`: This class provides an API for interacting with Firestore.
-   `FirebaseStorage.cs`: This class provides an API for interacting with Firebase Storage.
-   `FirebaseFunctions.cs`: This class provides an API for calling Firebase Functions.

## Conclusion

The Godot client is a key component of the Aikami project. By leveraging the power of Firebase, the client is able to provide a rich and immersive gaming experience to the user.
