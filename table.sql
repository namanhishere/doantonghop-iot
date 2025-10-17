CREATE TABLE room (
    id VARCHAR(50) PRIMARY KEY,
    roomname VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE rfid_card (
    uid VARCHAR(50) PRIMARY KEY,
    cardname VARCHAR(50)
);

CREATE TABLE rfid_access (
    card_uid VARCHAR(50),
    room_id VARCHAR(50),
    PRIMARY KEY (card_uid, room_id),
    FOREIGN KEY (card_uid) REFERENCES rfid_card(uid) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES room(id) ON DELETE CASCADE
);

CREATE TABLE qr_session (
    id VARCHAR(50) PRIMARY KEY,
    starttime DATETIME DEFAULT CURRENT_TIMESTAMP,
    endtime DATETIME DEFAULT NULL,
    room_id VARCHAR(50),
    FOREIGN KEY (room_id) REFERENCES room(id)
);

CREATE TABLE opencloselog (
    id INT AUTO_INCREMENT PRIMARY KEY,
    time DATETIME DEFAULT CURRENT_TIMESTAMP,
    room_id VARCHAR(50),
    action ENUM('OPEN', 'CLOSE') NOT NULL,
    card_uid VARCHAR(50) NULL,
    qr_id VARCHAR(50) NULL,
    web_trigger ENUM('CONSOLE', 'EXTERNAL') NULL,
    FOREIGN KEY (room_id) REFERENCES room(id),
    FOREIGN KEY (card_uid) REFERENCES rfid_card(uid),
    FOREIGN KEY (qr_id) REFERENCES qr_session(id)
);


INSERT INTO room (id, roomname) VALUES('101', 'Phòng 101'),('102', 'Phòng 102');

INSERT INTO rfid_card (uid, cardname) VALUES('E5C0F111', 'Thẻ sinh viên'),('3AED6A05', 'Thẻ Admin');

INSERT INTO rfid_access (card_uid, room_id) VALUES ('3AED6A05', '101'), ('3AED6A05', '102'), ('E5C0F111', '101');