/* Все числовые настройки игрового процесса находятся здесь. Время указано в секундах. */
window.FarmEconomy = Object.freeze({
  // Стартовые ресурсы и цена расширения фермы.
  initialCoins: 350,
  initialBeds: 3,
  firstBedPrice: 100,
  bedPriceMultiplier: 1.2,
  maxBedPrice: 9999,
  // Продажа возвращает половину цены покупки; удаление монет не возвращает.
  resaleRate: 0.5,

  // Тыква заменена кукурузой по согласованию: в утверждённом атласе есть кукуруза.
  catalog: Object.freeze([
    { id: "carrot", name: "Морковь", sprite: "carrot", price: 10, growSeconds: 10, baseValue: 20, unlockAfterOrders: 0 },
    { id: "apple", name: "Яблоко", sprite: "apple", price: 50, growSeconds: 20, baseValue: 100, unlockAfterOrders: 2 },
    { id: "tomato", name: "Помидор", sprite: "tomato", price: 100, growSeconds: 30, baseValue: 200, unlockAfterOrders: 5 },
    { id: "corn", name: "Кукуруза", sprite: "corn", price: 300, growSeconds: 45, baseValue: 600, unlockAfterOrders: 9 },
    { id: "bed", name: "Новая грядка", sprite: "soil" }
  ]),
  products: Object.freeze(["carrot", "apple", "tomato", "corn"]),

  // Заказы не истекают. Каждая следующая ступень открывается после сдачи заказов.
  orderIntervalSeconds: 30,
  maxOrders: 10,
  rewardMultiplier: 1.2,
  firstOrder: Object.freeze({ carrot: 2 }),
  orderDifficulty: Object.freeze([
    { afterCompleted: 0, minKinds: 1, maxKinds: 1, minUnits: 1, maxUnits: 2, maxPerKind: 2 },
    { afterCompleted: 2, minKinds: 1, maxKinds: 2, minUnits: 2, maxUnits: 3, maxPerKind: 2 },
    { afterCompleted: 5, minKinds: 1, maxKinds: 2, minUnits: 2, maxUnits: 4, maxPerKind: 3 },
    { afterCompleted: 9, minKinds: 2, maxKinds: 3, minUnits: 3, maxUnits: 6, maxPerKind: 3 }
  ]),

  // Если нельзя купить даже морковь, а свободная грядка простаивает, выдаём ровно её цену.
  rescueSeedId: "carrot",

  // Погода меняется по кругу; множитель определяет скорость роста растений.
  weather: Object.freeze([
    { id: "sun", durationSeconds: 90, growthMultiplier: 1 },
    { id: "clouds", durationSeconds: 60, growthMultiplier: 0.8 },
    { id: "rain", durationSeconds: 60, growthMultiplier: 1.2 }
  ]),

  // Курочка гуляет по свободной траве и иногда оставляет яйцо с монетами.
  chicken: Object.freeze({
    stepSeconds: 2.6,
    eggIntervalSeconds: 180,
    eggRewardCoins: 1000,
    maxEggs: 5
  }),

  // Рецепты пекарни: продукты со склада сразу превращаются в монеты.
  workshopRecipes: Object.freeze([
    { id: "apple-pie", name: "Яблочный пирог", image: "assets/apple-pie.png", ingredients: { apple: 3 }, reward: 450 },
    { id: "carrot-cake", name: "Морковный торт", image: "assets/carrot-cake.png", ingredients: { carrot: 4 }, reward: 120 },
    { id: "tomato-jam", name: "Томатный джем", image: "assets/tomato-jam.png", ingredients: { tomato: 3 }, reward: 900 },
    { id: "corn-pudding", name: "Кукурузный пудинг", image: "assets/corn-pudding.png", ingredients: { corn: 2 }, reward: 1800 }
  ]),

  // Украшения покупаются по одному и размещаются на свободной траве.
  designItems: Object.freeze([
    { id: "scarecrow", name: "Пугало", image: "assets/scarecrow.png", price: 200 },
    { id: "flowers", name: "Цветы", sprite: "flower", price: 40 },
    { id: "barrel", name: "Бочка", image: "assets/barrel.png", price: 100 },
    { id: "lantern", name: "Фонарь", image: "assets/lantern.png", price: 150 }
  ]),

  // Длительность уведомлений и анимаций, тоже в секундах.
  noticeSeconds: 2.5,
  growthUpdateSeconds: 0.1,
  animation: Object.freeze({
    orderEntrySeconds: 0.7,
    orderCardHoldSeconds: 5,
    orderDockSeconds: 0.75,
    harvestFlightSeconds: 0.65,
    deliveryFlightSeconds: 0.55,
    coinFlightSeconds: 0.6,
    coinStaggerSeconds: 0.1,
    valuePulseSeconds: 0.35,
    arrowReactionSeconds: 0.48,
    orderExitSeconds: 0.35,
    bedAppearSeconds: 0.55,
    plantAppearSeconds: 0.5
  })
});
