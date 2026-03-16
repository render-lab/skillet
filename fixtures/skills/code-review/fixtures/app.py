import sqlite3
import os

def get_user(user_id):
    conn = sqlite3.connect("users.db")
    cursor = conn.cursor()
    query = f"SELECT * FROM users WHERE id = {user_id}"
    cursor.execute(query)
    result = cursor.fetchone()
    return result

def save_file(filename, content):
    path = "/uploads/" + filename
    with open(path, "w") as f:
        f.write(content)
    return path

def process_data(items):
    result = []
    for i in range(len(items)):
        if items[i] != None:
            result.append(items[i] * 2)
    return result

API_KEY = "sk-1234567890abcdef"

def authenticate(password):
    if password == "admin123":
        return True
    return False
