# Programming Intergration Project (CO3103) - Extension of IOT Device

## Introduction
This project is a IOT's services of Classroom Booking System project by group 1 class CC06. The services can be splited and save to deploy localy in room's local server to ensure the safe protocol. However, publicly open to the internet is planned and we will update the authentication method soon.  

As planned, it have 3 part: An ESP32-CAM for QR scanning, An ESP-8266 for RFID reading and a web server to link and control it

## Project structure
```
|   .gitignore (use ignore folder)
|   boardMoCua.ino (ESP8266 rfid door lock board)
|   docker-compose.yaml (docker compose of database)
|   nodemon.json
|   package-lock.json ()
|   package.json (package file)
|   README.md (this readme file)
|   table.sql (inital database config)
|   tsconfig.json (typescript setting)
\---src
        index.ts (main ts server)
        
```


## About the ESP-8266
In this project, Our team using a NodeMCU ESP-8266, a RFID-RC522, JF-0520B Electric lock and a Relay for electrical isolation. 

**RFID RC522 pins → NodeMCU**  
SDA (SS) → D2 (GPIO4)  
SCK → D5 (GPIO14)  
MOSI → D7 (GPIO13)  
MISO → D6 (GPIO12)  
RST → D1 (GPIO5)  
3.3V → 3.3V  
GND → GND  

**Relay module:**  
IN → D0 (GPIO16)  
VCC → 3.3V (our team using 3.3V relay)  
GND → GND

This module will read the 13.56 MHz RFID card (mifare) and verify it with saved database of card in server. If accepted, it will emit the open signal to the relay to turn the electric lock and open the door

## About the Back-end server
### Servies database schema
<img width="1445" height="733" alt="image" src="https://github.com/user-attachments/assets/975b0589-e8e5-47d3-9a04-60a5a5247009" />

### Idea of the servies
The back-end server is the core middleware that bridges the communication between the IoT devices (ESP32-CAM and ESP8266) and the centralized Classroom Booking System. It handles device registration, authentication verification, door control commands, and event logging — all while maintaining real-time synchronization and data integrity across components.


## Futher plans of the extension 
1. JWT or API Key Authentication for device registration.
2. Complete the ESP32-Cam device
3. Small Dashboard for administrators to directlly control the device and add/edit card, room,etc.. 
