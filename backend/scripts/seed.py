# scripts/seed.py
import asyncio
from app.db.session import AsyncSessionLocal, engine, Base
from app.db import models
from app.db.crud_users import create_user, get_user_by_email
from app.db.crud_properties import create_property
import random, os

async def seed():
    async with AsyncSessionLocal() as db:
        # create tables (if migrations not run)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # create admin
        admin = await get_user_by_email(db, 'admin@example.com')
        if not admin:
            await create_user(db, name='Admin', email='admin@example.com', password='password', phone='+911234567890', role='admin')
        # hosts
        hosts = []
        for i in range(3):
            email = f'host{i}@example.com'
            h = await get_user_by_email(db, email)
            if not h:
                h = await create_user(db, name=f'Host {i}', email=email, password='password', phone=f'+9111000000{i}', role='host')
            hosts.append(h)
        # properties sample
        cities = ['Delhi','Mumbai','Bengaluru','Pune']
        for i in range(20):
            host = random.choice(hosts)
            await create_property(db, title=f'Room {i}', description='Nice room', price=500+i*10, type='Room', gender='Any', city=random.choice(cities), locality='Area', images=['/static/uploads/sample.jpg'], host_id=host.id)
        print('Seed complete')

if __name__ == '__main__':
    asyncio.run(seed())
