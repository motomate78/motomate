const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clear existing data (optional, be careful)
  // await prisma.like.deleteMany({});
  // await prisma.message.deleteMany({});
  // await prisma.chat.deleteMany({});
  // await prisma.user.deleteMany({});

  const users = [
    {
      name: 'Алексей',
      email: 'alexey@example.com',
      age: 28,
      city: 'Москва',
      bike: 'Yamaha MT‑07',
      gender: 'male',
      has_bike: true,
      about: 'Люблю ночные прохваты и кофе на заправке.',
      image: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=400&h=400&fit=crop',
      images: JSON.stringify(['https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800']),
      latitude: 55.751244,
      longitude: 37.618423,
    },
    {
      name: 'Елена',
      email: 'elena@example.com',
      age: 25,
      city: 'Москва',
      bike: 'Kawasaki Ninja 400',
      gender: 'female',
      has_bike: true,
      about: 'Ищу компанию на выходные: покататься и поесть вкусно.',
      image: 'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=400&h=400&fit=crop',
      images: JSON.stringify(['https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=800']),
      latitude: 55.734,
      longitude: 37.605,
    },
    {
      name: 'Дмитрий',
      email: 'dmitry@example.com',
      age: 32,
      city: 'Санкт-Петербург',
      bike: 'BMW S1000RR',
      gender: 'male',
      has_bike: true,
      about: 'Трек-дни, техника и дисциплина. На дороге — спокойно.',
      image: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=400&h=400&fit=crop',
      images: JSON.stringify(['https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800']),
      latitude: 59.9311,
      longitude: 30.3609,
    },
    {
      name: 'Мария',
      email: 'maria@example.com',
      age: 23,
      city: 'Москва',
      bike: 'Honda Rebel 500',
      gender: 'female',
      has_bike: true,
      about: 'Спокойный темп, красивые маршруты и хорошие люди.',
      image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
      images: JSON.stringify(['https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800']),
      latitude: 55.761,
      longitude: 37.64,
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: user,
      create: user,
    });
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
